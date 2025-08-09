'use client';
import React, { useEffect, useMemo, useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, MouseSensor, TouchSensor,
  useSensor, useSensors, useDroppable
} from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToWindowEdges } from "@dnd-kit/modifiers";
import { motion } from "framer-motion";
import LZString from "lz-string";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Download, Link2, Plus, RefreshCcw, Upload, Scissors, Trash2 } from "lucide-react";

type Item = { id: string; name: string; image?: string };
type Row = { label: string; color: string };
type Col = { label: string; color: string };
type AppState = { rows: Row[]; cols: Col[]; colWidths: number[]; containers: Record<string, string[]>; items: Record<string, Item>; poolId: string; tileSize: number; forceDark: boolean };

const POOL_ID = "__pool__";
const DEFAULT_ROWS: Row[] = [
  { label: "Bas", color: "#ef4444" }, { label: "Moyen", color: "#f59e0b" },
  { label: "Haut", color: "#22c55e" }, { label: "S-tier", color: "#6366f1" },
];
const DEFAULT_COLS: Col[] = [
  { label: "Gauche", color: "#14b8a6" }, { label: "Centre", color: "#06b6d4" }, { label: "Droite", color: "#a855f7" },
];
const TILE_BG = "#23242a"; const TILE_BORDER = "#3f3f46";
const slug = (s: string) => s.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");
function normalizeText(s: string) { return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function textColorForBg(hex: string) { try { let c = hex.replace("#", ""); if (c.length === 3) c = c.split("").map((x)=>x+x).join(""); const r=parseInt(c.slice(0,2),16), g=parseInt(c.slice(2,4),16), b=parseInt(c.slice(4,6),16); return ((r*299+g*587+b*114)/1000)>=140?"#111827":"#FFFFFF"; } catch { return "#FFFFFF"; } }
function splitImport(text: string): string[] { return text.split(/\r?\n|,|;|\t/g).map(s=>s.trim()).filter(Boolean); }
function normalizeImageURL(u?: string) { if (!u) return u; try { const url = new URL(u); if (url.protocol==="http:") { return `https://images.weserv.nl/?url=${encodeURIComponent(url.host+url.pathname+url.search)}`; } return u; } catch { return u; } }
function sortIdsAlpha(ids: string[], items: Record<string, Item>) { return [...ids].sort((a,b)=> normalizeText(items[a]?.name||a).localeCompare(normalizeText(items[b]?.name||b), "fr", {sensitivity:"base"})); }
function parsePairs(text: string): Array<{ name: string; image?: string }> { const lines = text.split(/\r?\n/g).map(l=>l.trim()).filter(Boolean); const out: Array<{name:string; image?:string}> = []; for (const line of lines) { const m = line.match(/https?:\/\/\S+/); if (m) { const url=m[0]; const name=line.replace(url,"").split(/[|;,\t]/).join(" ").trim().replace(/\s{2,}/g," "); out.push({ name: name||url, image: url }); } else { out.push({ name: line }); } } return out; }
function cx(...cls: Array<string|false|null|undefined>) { return cls.filter(Boolean).join(" "); }
const INPUT_DARK = "input-dark"; const OUTLINE_DARK = "btn-outline-dark";

function Tile({ id, name, image, tileSize, selected, highlighted, onClick }:{ id:string; name:string; image?:string; tileSize:number; selected?:boolean; highlighted?:boolean; onClick?:()=>void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, width: tileSize, height: tileSize, touchAction: "none" };
  return (
    <motion.div ref={setNodeRef} style={style} layout data-item-id={id} onClick={onClick}
      className={cx("relative overflow-hidden select-none inline-flex items-center justify-center rounded-2xl shadow-sm border p-2 text-sm font-medium cursor-grab active:cursor-grabbing",
      "text-zinc-100")} {...attributes} {...listeners}>
      <div className="absolute inset-0 rounded-2xl" style={{ backgroundColor: TILE_BG, border: `1px solid ${TILE_BORDER}` }} />
      {image ? (<>
        <div className="absolute inset-0 rounded-2xl overflow-hidden">
          <Image src={image} alt={name} fill sizes="200px" style={{ objectFit: "cover", borderRadius: 16 }} />
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1 text-[11px] text-center rounded-b-2xl">
          <span className="font-semibold text-white drop-shadow-sm px-1">{name}</span>
        </div>
      </>) : (<span className="relative text-center leading-tight px-1 break-words z-10">{name}</span>)}
    </motion.div>
  );
}
function Droppable({ id, children, onClick }:{ id:string; children:React.ReactNode; onClick?:()=>void }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (<div ref={setNodeRef} data-droppable-id={id} onClick={onClick} className={cx("min-h-[120px] rounded-md", isOver && "ring-2 ring-indigo-500/60", "bg-zinc-900")} style={{ touchAction: "none" }}>{children}</div>);
}
function makeEmptyGrid(rowsLen:number, colsLen:number){ const containers:Record<string,string[]> = {}; for(let r=0;r<rowsLen;r++) for(let c=0;c<colsLen;c++) containers[`r${r}-c${c}`]=[]; containers[POOL_ID]=[]; return containers; }
function stateFromNames(names:string[]):AppState{ const items:Record<string,Item>={}; const containers=makeEmptyGrid(DEFAULT_ROWS.length, DEFAULT_COLS.length); const pool:string[]=[];
  names.forEach((n)=>{ const idBase=slug(n)||Math.random().toString(36).slice(2); const id=items[idBase]?`${idBase}-${Math.random().toString(36).slice(2,6)}`:idBase; items[id]={id,name:n}; pool.push(id); });
  containers[POOL_ID]=sortIdsAlpha(pool, items);
  return { rows: JSON.parse(JSON.stringify(DEFAULT_ROWS)), cols: JSON.parse(JSON.stringify(DEFAULT_COLS)), colWidths: Array(DEFAULT_COLS.length).fill(220), containers, items, poolId: POOL_ID, tileSize: 96, forceDark: true };
}
function stateFromEntries(entries:Array<{name:string; image?:string; id?:string}>):AppState{ const items:Record<string,Item>={}; const containers=makeEmptyGrid(DEFAULT_ROWS.length, DEFAULT_COLS.length); const pool:string[]=[];
  entries.forEach(({name,image,id})=>{ const base=slug(id||name)||Math.random().toString(36).slice(2); const uid=items[base]?`${base}-${Math.random().toString(36).slice(2,6)}`:base; items[uid]={id:uid, name, image: normalizeImageURL(image)}; pool.push(uid); });
  containers[POOL_ID]=sortIdsAlpha(pool, items);
  return { rows: JSON.parse(JSON.stringify(DEFAULT_ROWS)), cols: JSON.parse(JSON.stringify(DEFAULT_COLS)), colWidths: Array(DEFAULT_COLS.length).fill(220), containers, items, poolId: POOL_ID, tileSize: 96, forceDark: true };
}
function encodeState(s:AppState){ try{return LZString.compressToEncodedURIComponent(JSON.stringify(s));}catch{return"";} }
function decodeState(s:string){ try{ const json=LZString.decompressFromEncodedURIComponent(s); if(!json)return null; return JSON.parse(json);}catch{return null;} }
function migrateState(obj:any):AppState|null{ if(!obj)return null; const rows:Row[]=Array.isArray(obj.rows)?obj.rows.map((r:any,i:number)=> typeof r==='string'?{label:r,color:DEFAULT_ROWS[i%DEFAULT_ROWS.length].color}:r):DEFAULT_ROWS;
  const cols:Col[]=Array.isArray(obj.cols)?obj.cols.map((c:any,i:number)=> typeof c==='string'?{label:c,color:DEFAULT_COLS[i%DEFAULT_COLS.length].color}:c):DEFAULT_COLS;
  const containers:Record<string,string[]> = obj.containers||makeEmptyGrid(rows.length, cols.length); const items:Record<string,Item> = obj.items||{}; const poolId=obj.poolId||POOL_ID; const tileSize=typeof obj.tileSize==='number'?obj.tileSize:96; const forceDark=typeof obj.forceDark==='boolean'?obj.forceDark:true;
  const colWidths:number[] = Array.isArray(obj.colWidths)&&obj.colWidths.length===cols.length? obj.colWidths.map((n:any)=> typeof n==='number'?n:220): Array(cols.length).fill(220);
  for(let r=0;r<rows.length;r++) for(let c=0;c<cols.length;c++){ const id=`r${r}-c${c}`; if(!containers[id]) containers[id]=[]; } if(!containers[poolId]) containers[poolId]=[];
  containers[poolId] = sortIdsAlpha(containers[poolId], items);
  return { rows, cols, colWidths, containers, items, poolId, tileSize, forceDark };
}
function assert(name:string, cond:boolean){ if(cond) console.log(`✅ ${name}`); else console.error(`❌ ${name}`); }
function runSelfTests(){ const s1=splitImport(`A,B;C\tD\nE\r\nF`); assert("splitImport handles , ; \t and newlines", s1.join("|")==="A|B|C|D|E|F");
  const pp=parsePairs(`Alpha\thttp://x/a.jpg\nBeta | https://x/b.webp\nGamma`); assert("parsePairs length", pp.length===3); assert("parsePairs images detected", !!pp[0].image && !!pp[1].image && !pp[2].image);
  const st=stateFromEntries([{name:"Alpha"},{name:"Beta", image:"http://x/b.jpg"}]); assert("stateFromEntries pool size",(st.containers[st.poolId]||[]).length===2);
  const enc=encodeState(st); const dec=decodeState(enc as string); assert("encode/decode works", !!dec && typeof dec==='object');
  const mig=migrateState({rows:["R1"], cols:["C1"], containers:{[POOL_ID]:[]}, items:{}}); assert("migrateState basic", !!mig && Array.isArray(mig.rows) && Array.isArray(mig.cols)); }

export default function Page(){
  const initialState = useMemo<AppState>(()=>{ const hash=typeof window!=='undefined'?window.location.hash.replace(/^#/,""):""; if(hash){ const dec=decodeState(hash); const mig=migrateState(dec); if(mig) return mig; }
    if(typeof window!=='undefined'){ const raw=localStorage.getItem("tierlist2d-state"); if(raw){ try{ const mig=migrateState(JSON.parse(raw)); if(mig) return mig; }catch{} } } return stateFromNames([]); },[]);
  const [state,setState] = useState<AppState>(initialState);
  const [activeId,setActiveId] = useState<string|null>(null);
  const [pairsText,setPairsText] = useState("");
  const [search,setSearch] = useState("");
  const [selectedId,setSelectedId] = useState<string|null>(null);

  const matchedIds = useMemo(()=>{ const q=normalizeText(search); if(!q) return new Set<string>(); const s=new Set<string>(); for(const [id,it] of Object.entries(state.items)){ if(normalizeText(it.name).includes(q)) s.add(id); } return s; },[state.items,search]);

  const sensors = useSensors(useSensor(PointerSensor,{activationConstraint:{distance:2}}), useSensor(MouseSensor), useSensor(TouchSensor));
  useEffect(()=>{ try{ localStorage.setItem("tierlist2d-state", JSON.stringify(state)); }catch{} },[state]);
  useEffect(()=>{ try{ const g:any=typeof globalThis!=='undefined'?(globalThis as any):{}; const isDev=!!g.process?.env?.NODE_ENV ? g.process.env.NODE_ENV!=="production" : false; if(isDev && typeof window!=="undefined"){ const w:any=window as any; if(!w.__tier2d_tests_ran__){ w.__tier2d_tests_ran__=true; runSelfTests(); } } }catch{} },[]);

  useEffect(()=>{ setState(prev=>{ const containers={...prev.containers}; for(let r=0;r<prev.rows.length;r++) for(let c=0;c<prev.cols.length;c++) if(!containers[`r${r}-c${c}`]) containers[`r${r}-c${c}`]=[];
    const valid=new Set<string>([prev.poolId]); for(let r=0;r<prev.rows.length;r++) for(let c=0;c<prev.cols.length;c++) valid.add(`r${r}-c${c}`);
    const pool=[...(containers[prev.poolId]||[])]; Object.keys(containers).forEach((k)=>{ if(!valid.has(k)){ pool.push(...containers[k]); delete containers[k]; }});
    containers[prev.poolId]=sortIdsAlpha(pool, prev.items); return {...prev, containers}; }); },[state.rows.length, state.cols.length]);

  const getContainerByItem=(itemId:string)=>{ for(const [cid,arr] of Object.entries(state.containers)) if(arr.includes(itemId)) return cid; return null; };
  function moveToContainer(itemId:string, containerId:string){ setState(prev=>{ const next={...prev, containers:{...prev.containers}} as AppState; const from=getContainerByItem(itemId); if(!from) return prev;
    if(!next.containers[containerId]) next.containers[containerId]=[]; const src=[...next.containers[from]]; const idx=src.indexOf(itemId); if(idx>-1) src.splice(idx,1); next.containers[from]=src;
    next.containers[containerId]=[...next.containers[containerId], itemId]; if(containerId===next.poolId){ next.containers[containerId]=sortIdsAlpha(next.containers[containerId], next.items); } return next; }); }

  function handleDragStart(e:any){ setActiveId(e.active?.id??null); }
  function handleDragOver(e:any){ const {active,over}=e; if(!over) return; const aid=active.id as string; const oid=over.id as string; if(oid===undefined) return;
    const src=getContainerByItem(aid); const dst=oid.startsWith("r")||oid===POOL_ID ? oid : getContainerByItem(oid); if(!src||!dst||src===dst) return;
    setState(prev=>{ const next={...prev, containers:{...prev.containers}} as AppState; const sItems=[...next.containers[src]]; const dItems=[...next.containers[dst]]; const i=sItems.indexOf(aid); if(i>-1) sItems.splice(i,1); dItems.push(aid);
      next.containers[src]=sItems; next.containers[dst]=dItems; if(dst===next.poolId){ next.containers[dst]=sortIdsAlpha(next.containers[dst], next.items);} return next; }); }
  function handleDragEnd(e:any){ const {active,over}=e; setActiveId(null); if(!over) return; const aid=active.id as string; const oid=over.id as string;
    const src=getContainerByItem(aid); const dst=oid.startsWith("r")||oid===POOL_ID ? oid : getContainerByItem(oid); if(!src||!dst) return;
    if(src===dst){ setState(prev=>{ const items=[...prev.containers[src]]; if(src===prev.poolId){ return {...prev, containers:{...prev.containers, [src]: sortIdsAlpha(items, prev.items)}} as AppState; }
      const oldIndex=items.indexOf(aid); let newIndex=items.indexOf(oid); if(newIndex===-1) newIndex=oldIndex; return {...prev, containers:{...prev.containers, [src]: arrayMove(items, oldIndex, newIndex)}} as AppState; }); } }

  function addRow(){ setState(s=>({...s, rows:[...s.rows, {label:`Ligne ${s.rows.length+1}`, color:"#94a3b8"}]})); }
  function addCol(){ setState(s=>({...s, cols:[...s.cols, {label:`Colonne ${s.cols.length+1}`, color:"#94a3b8"}], colWidths:[...s.colWidths, s.colWidths.at(-1)??220]})); }
  function removeRow(i:number){ setState(s=>({...s, rows:s.rows.filter((_,idx)=>idx!==i)})); }
  function removeCol(i:number){ setState(s=>({...s, cols:s.cols.filter((_,idx)=>idx!==i), colWidths:s.colWidths.filter((_,idx)=>idx!==i)})); }
  function renameRow(i:number,v:string){ setState(s=>{ const rows=[...s.rows]; rows[i]={...rows[i], label:v}; return {...s, rows}; }); }
  function recolorRow(i:number,v:string){ setState(s=>{ const rows=[...s.rows]; rows[i]={...rows[i], color:v}; return {...s, rows}; }); }
  function renameCol(i:number,v:string){ setState(s=>{ const cols=[...s.cols]; cols[i]={...cols[i], label:v}; return {...s, cols}; }); }
  function recolorCol(i:number,v:string){ setState(s=>{ const cols=[...s.cols]; cols[i]={...s.cols[i], color:v}; return {...s, cols}; }); }
  function clearGridKeepItems(){ setState(s=>{ const containers=Object.fromEntries(Object.keys(s.containers).map(k=>[k,[] as string[]])); const allIds=Object.values(s.containers).flat(); (containers as any)[s.poolId]=sortIdsAlpha(allIds, s.items); return {...s, containers} as AppState; }); }
  function resetAll(){ setState(stateFromNames([])); history.replaceState(null,"","#"); }
  function exportState(){ try{ const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="tierlist2d_state.json"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),5000);}catch{ alert("Export impossible"); } }
  function importStateFromFile(file:File){ const reader=new FileReader(); reader.onload=()=>{ try{ const obj=JSON.parse(String(reader.result)); if(Array.isArray(obj)){ if(obj.length && typeof obj[0]==="object" && obj[0].name){ setState(stateFromEntries(obj)); } else { setState(stateFromNames(obj.map(String))); } return; } const mig=migrateState(obj); if(mig) setState(mig); }catch{ alert("Fichier invalide"); } }; reader.readAsText(file); }
  function shareURL(copyOnly=true){ const enc=encodeState(state); if(!enc) return; const url=`${location.origin}${location.pathname}#${enc}`; navigator.clipboard?.writeText(url); if(!copyOnly) history.replaceState(null,"",`#${enc}`); alert("Lien copié dans le presse-papiers ✨"); }
  function importPairs(){ const entries=parsePairs(pairsText); if(!entries.length) return; const items={...state.items}; const pool=[...(state.containers[state.poolId]||[])]; for(const {name,image} of entries){ const base=slug(name)||Math.random().toString(36).slice(2); const uid=items[base]?`${base}-${Math.random().toString(36).slice(2,6)}`:base; items[uid]={id:uid, name, image: normalizeImageURL(image)}; pool.push(uid); } setPairsText(""); setState(s=>({...s, items, containers:{...s.containers, [s.poolId]: sortIdsAlpha(pool, items)}})); }

  const colsPx = (state.colWidths?.length
  ? state.colWidths
  : Array(state.cols.length).fill(220)
).map(w => String(w) + 'px').join(' ');

const gridTemplate = {
  gridTemplateColumns: `minmax(140px, max-content) ${colsPx}`,
} as React.CSSProperties;
  const poolIds = state.containers[state.poolId] || [];

  return (
    <div className={"min-h-screen bg-zinc-950 text-zinc-50"}>
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl md:text-3xl font-bold">Tier list 2D – Rap FR</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={()=>{ const containers=Object.fromEntries(Object.keys(state.containers).map(k=>[k,[]])); (containers as any)[state.poolId]=sortIdsAlpha(Object.values(state.containers).flat(), state.items); setState(s=>({...s, containers: containers as any})); }} title="Tout renvoyer en bas"><Scissors className="w-4 h-4 mr-2" /> Vider la grille</Button>
          <Button variant="outline" className={OUTLINE_DARK} onClick={exportState} title="Exporter l'état en JSON"><Download className="w-4 h-4 mr-2" /> Exporter</Button>
          <label className="inline-flex items-center gap-2 cursor-pointer"><Upload className="w-4 h-4" /><span className="text-sm">Importer .json</span>
            <input type="file" accept="application/json" className="hidden" onChange={(e)=>{ const f=(e.target as HTMLInputElement).files?.[0]; if(f) importStateFromFile(f); (e.currentTarget as HTMLInputElement).value=""; }} /></label>
          <Button onClick={()=>shareURL(false)} title="Mettre l'état dans l'URL et copier le lien"><Link2 className="w-4 h-4 mr-2" /> Partager le lien</Button>
          <Button variant="destructive" onClick={resetAll} title="Réinitialiser complètement"><RefreshCcw className="w-4 h-4 mr-2" /> Réinitialiser</Button>
          <Input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Rechercher…" className={"w-44 input-dark"} />
          <Button variant="outline" className={OUTLINE_DARK} onClick={()=>{ const id=Array.from(matchedIds)[0]; if(!id) return; const el=document.querySelector(`[data-item-id="${id}"]`) as HTMLElement | null; el?.scrollIntoView({behavior:"smooth", block:"center", inline:"center"}); }}>Trouver</Button>
          {search && (<Button variant="outline" className={OUTLINE_DARK} onClick={()=>setSearch("")}>Effacer</Button>)}
        </div>
      </div>

      <Card><CardHeader><CardTitle>Axes & options</CardTitle></CardHeader><CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div><Label className="mb-2 block">Axe vertical (lignes) — texte & couleur</Label>
            <div className="space-y-2">{state.rows.map((r,i)=>(<div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
              <Input className={"input-dark"} value={r.label} onChange={(e:any)=> setState(s=>{ const rows=[...s.rows]; rows[i]={...rows[i], label:e.target.value}; return {...s, rows}; })} />
              <input type="color" value={r.color} onChange={(e:any)=> setState(s=>{ const rows=[...s.rows]; rows[i]={...rows[i], color:e.target.value}; return {...s, rows}; })} title="Couleur de la ligne" className="h-10 w-12 rounded cursor-pointer border" />
              <div className="px-3 py-2 rounded-md text-xs font-semibold text-center" style={{ backgroundColor:r.color, color: textColorForBg(r.color) }} title="Aperçu">Aperçu</div>
              <Button variant="outline" className={OUTLINE_DARK} size="icon" onClick={()=> setState(s=>({...s, rows:s.rows.filter((_,idx)=>idx!==i)}))} title="Supprimer la ligne"><Trash2 className="w-4 h-4" /></Button>
            </div>))}<Button onClick={()=> setState(s=>({...s, rows:[...s.rows, {label:`Ligne ${s.rows.length+1}`, color:"#94a3b8"}]}))} className="mt-1"><Plus className="w-4 h-4 mr-2" /> Ajouter une ligne</Button></div>
          <div><Label className="mb-2 block">Axe horizontal (colonnes) — texte & couleur</Label>
            <div className="space-y-2">{state.cols.map((c,i)=>(<div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
              <Input className={"input-dark"} value={c.label} onChange={(e:any)=> setState(s=>{ const cols=[...s.cols]; cols[i]={...cols[i], label:e.target.value}; return {...s, cols}; })} />
              <input type="color" value={c.color} onChange={(e:any)=> setState(s=>{ const cols=[...s.cols]; cols[i]={...cols[i], color:e.target.value}; return {...s, cols}; })} title="Couleur de la colonne" className="h-10 w-12 rounded cursor-pointer border" />
              <div className="px-3 py-2 rounded-md text-xs font-semibold text-center" style={{ backgroundColor:c.color, color: textColorForBg(c.color) }} title="Aperçu">Aperçu</div>
              <Button variant="outline" className={OUTLINE_DARK} size="icon" onClick={()=> setState(s=>({...s, cols:s.cols.filter((_,idx)=>idx!==i)}))} title="Supprimer la colonne"><Trash2 className="w-4 h-4" /></Button>
            </div>))}<Button onClick={()=> setState(s=>({...s, cols:[...s.cols, {label:`Colonne ${s.cols.length+1}`, color:"#94a3b8"}]}))} className="mt-1"><Plus className="w-4 h-4 mr-2" /> Ajouter une colonne</Button></div>
        </div>
      </CardContent></Card>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} modifiers={[restrictToWindowEdges]}>
        <div className={"overflow-auto rounded-2xl border bg-zinc-900 border-zinc-800"}>
          <div className="grid gap-2 p-2" style={gridTemplate}>
            <div />
            {state.cols.map((c,ci)=>(<div key={`colh-${ci}`} className={"sticky top-0 z-10 rounded-xl p-2 text-sm font-semibold border border-zinc-800"} style={{ backgroundColor:c.color, color:textColorForBg(c.color) }}>{c.label}</div>))}
            {state.rows.map((r,ri)=>(<React.Fragment key={`row-${ri}`}>
              <div className={"sticky left-0 z-10 rounded-xl p-2 text-sm font-semibold border border-zinc-800"} style={{ backgroundColor:r.color, color:textColorForBg(r.color) }}>{r.label}</div>
              {state.cols.map((_,ci)=>{ const id=`r${ri}-c${ci}`; const items=state.containers[id]||[]; return (
                <Card key={id} className={"w-full h-full border border-zinc-800 bg-zinc-900"}><CardContent className={"p-2 bg-zinc-900"}>
                  <Droppable id={id} onClick={()=> selectedId && (moveToContainer(selectedId, id), setSelectedId(null))}><SortableContext id={id} items={items} strategy={rectSortingStrategy}>
                    <div className={"relative w-full flex flex-wrap gap-2"} style={{ minHeight:120 }} data-cell-id={id}>
                      {items.map((itemId)=>(<Tile key={itemId} id={itemId} name={state.items[itemId]?.name ?? itemId} image={state.items[itemId]?.image} tileSize={state.tileSize} selected={selectedId===itemId} highlighted={matchedIds.has(itemId)} onClick={()=> setSelectedId(itemId)} />))}
                    </div>
                  </SortableContext></Droppable>
                </CardContent></Card> ); })}
            </React.Fragment>))}
          </div>
        </div>
        <Card><CardHeader className="flex items-center justify-between"><CardTitle>Bac (non classés)</CardTitle>
          <Button variant="destructive" size="sm" onClick={()=>{ const pool=state.containers[state.poolId]||[]; const items={...state.items}; for(const id of pool) delete items[id]; setState(prev=>({...prev, items, containers:{...prev.containers, [prev.poolId]: []}})); }}><Trash2 className="w-4 h-4 mr-1" /> Vider le bac</Button></CardHeader>
          <CardContent className={"bg-zinc-900"}><Droppable id={state.poolId} onClick={()=> selectedId && (moveToContainer(selectedId, state.poolId), setSelectedId(null))}><SortableContext id={state.poolId} items={poolIds} strategy={rectSortingStrategy}>
            <div className="flex flex-wrap gap-2 p-2">{poolIds.map((itemId)=>(<Tile key={itemId} id={itemId} name={state.items[itemId]?.name ?? itemId} image={state.items[itemId]?.image} tileSize={state.tileSize} selected={selectedId===itemId} highlighted={matchedIds.has(itemId)} onClick={()=> setSelectedId(itemId)} />))}</div>
          </SortableContext></Droppable></CardContent></Card>
        <DragOverlay>{activeId ? (<Tile id={activeId} name={state.items[activeId]?.name ?? ""} image={state.items[activeId]?.image} tileSize={state.tileSize} />) : null}</DragOverlay>
      </DndContext>

      <Card><CardHeader><CardTitle>Importer noms + images</CardTitle></CardHeader><CardContent className="space-y-3">
        <p className={"text-sm text-zinc-400"}>Une ligne par artiste. Formats acceptés : <code>Nom\tURL</code>, <code>Nom | URL</code>, <code>Nom,URL</code>, <code>Nom;URL</code>.</p>
        <Textarea className={"input-dark"} rows={6} value={pairsText} onChange={(e)=>setPairsText(e.target.value)} placeholder={`Ex.\nNekfeu\thttps://upload.wikimedia.org/wikipedia/commons/3/30/Nekfeu_2015.jpg\nPNL | https://i.imgur.com/9Jr2s5W.jpeg`} />
        <div className="flex gap-2"><Button onClick={importPairs}><Upload className="w-4 h-4 mr-2" />Ajouter au bac</Button>
          <Button variant="outline" className={OUTLINE_DARK} onClick={()=> setPairsText("")}><Trash2 className="w-4 h-4 mr-2" />Vider la zone</Button></div>
      </CardContent></Card>
      <div className={"text-xs text-zinc-400"}><p>Persistance : l'état est sauvegardé dans votre navigateur et peut être encodé dans l'URL (bouton « Partager le lien »). Déployez sur Vercel pour un lien public.</p></div>
    </div></div>
  );
}
