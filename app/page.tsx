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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Download, Link2, Plus, RefreshCcw, Upload, Scissors, Trash2 } from "lucide-react";

type Item = { id: string; name: string };
type Row = { label: string; color: string };
type Col = { label: string; color: string };
type AppState = {
  rows: Row[]; cols: Col[];
  containers: Record<string, string[]>;
  items: Record<string, Item>;
  poolId: string;
  tileSize: number;
  wrapMode: "height" | "width";
  forceDark: boolean;
};

const POOL_ID = "__pool__";
const DEFAULT_ROWS: Row[] = [
  { label: "Bas", color: "#ef4444" },
  { label: "Moyen", color: "#f59e0b" },
  { label: "Haut", color: "#22c55e" },
  { label: "S-tier", color: "#6366f1" },
];
const DEFAULT_COLS: Col[] = [
  { label: "Gauche", color: "#14b8a6" },
  { label: "Centre", color: "#06b6d4" },
  { label: "Droite", color: "#a855f7" },
];

const slug = (s: string) => s.toLowerCase().trim().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");
const normalizeText = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function textColorForBg(hex: string) { try { let c = hex.replace("#",""); if (c.length===3) c=c.split("").map(x=>x+x).join("");
  const r=parseInt(c.slice(0,2),16), g=parseInt(c.slice(2,4),16), b=parseInt(c.slice(4,6),16);
  return ((r*299+g*587+b*114)/1000)>=140 ? "#111827" : "#FFFFFF"; } catch { return "#FFFFFF"; } }
function splitImport(text: string): string[] { return text.split(/\r?\n|,|;|\t/g).map(s=>s.trim()).filter(Boolean); }
function cx(...cls: Array<string|false|null|undefined>) { return cls.filter(Boolean).join(" "); }

const DARK = { pageBg:"bg-zinc-950", pageText:"text-zinc-50", cardBg:"bg-zinc-900", cardBorder:"border-zinc-800", mutedText:"text-zinc-400" };

function Tile({ id, name, tileSize }: { id:string; name:string; tileSize:number }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, width: tileSize, height: tileSize, touchAction: "none" };
  return (
    <motion.div ref={setNodeRef} style={style} layout
      className={cx("select-none inline-flex items-center justify-center rounded-2xl shadow-sm border p-2 text-sm font-medium cursor-grab active:cursor-grabbing",
        "bg-zinc-900 text-zinc-100 border-zinc-800")}
      {...attributes} {...listeners}>
      <span className="text-center leading-tight px-1 break-words">{name}</span>
    </motion.div>
  );
}
function Droppable({ id, children }: { id:string; children:React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} data-droppable-id={id} className={cx("min-h-[120px] rounded-md", isOver && "ring-2 ring-indigo-500/60")} style={{ touchAction:"none" }}>{children}</div>;
}

function makeEmptyGrid(rowsLen:number, colsLen:number){ const containers:Record<string,string[]> = {};
  for(let r=0;r<rowsLen;r++) for(let c=0;c<colsLen;c++) containers[`r${r}-c${c}`]=[]; containers[POOL_ID]=[]; return containers; }
function stateFromNames(names:string[]):AppState{ const items:Record<string,Item>={}; const containers=makeEmptyGrid(DEFAULT_ROWS.length, DEFAULT_COLS.length); const pool:string[]=[];
  names.forEach((n)=>{ const idBase=slug(n)||Math.random().toString(36).slice(2); const id=items[idBase]?`${idBase}-${Math.random().toString(36).slice(2,6)}`:idBase; items[id]={id,name:n}; pool.push(id); });
  containers[POOL_ID]=pool; return { rows:JSON.parse(JSON.stringify(DEFAULT_ROWS)), cols:JSON.parse(JSON.stringify(DEFAULT_COLS)),
  containers, items, poolId:POOL_ID, tileSize:96, wrapMode:"height", forceDark:true }; }
function encodeState(s:AppState){ try{return LZString.compressToEncodedURIComponent(JSON.stringify(s));}catch{return"";} }
function decodeState(s:string){ try{ const json=LZString.decompressFromEncodedURIComponent(s); if(!json) return null; return JSON.parse(json);}catch{return null;} }
function migrateState(obj:any):AppState|null{ if(!obj) return null;
  const rows:Row[]=Array.isArray(obj.rows)?obj.rows.map((r:any,i:number)=> typeof r==='string'?{label:r,color:DEFAULT_ROWS[i%DEFAULT_ROWS.length].color}:r):DEFAULT_ROWS;
  const cols:Col[]=Array.isArray(obj.cols)?obj.cols.map((c:any,i:number)=> typeof c==='string'?{label:c,color:DEFAULT_COLS[i%DEFAULT_COLS.length].color}:c):DEFAULT_COLS;
  const containers:Record<string,string[]> = obj.containers||makeEmptyGrid(rows.length, cols.length);
  const items:Record<string,Item> = obj.items||{}; const poolId=obj.poolId||POOL_ID;
  const tileSize=typeof obj.tileSize==='number'?obj.tileSize:96; const wrapMode = obj.wrapMode === "width" ? "width" : "height";
  const forceDark=typeof obj.forceDark==='boolean'?obj.forceDark:true;
  for(let r=0;r<rows.length;r++) for(let c=0;c<cols.length;c++){ const id=`r${r}-c${c}`; if(!containers[id]) containers[id]=[]; }
  if(!containers[poolId]) containers[poolId]=[];
  return { rows, cols, containers, items, poolId, tileSize, wrapMode, forceDark }; }

function assert(name:string, cond:boolean){ if(cond) console.log(`✅ ${name}`); else console.error(`❌ ${name}`); }
function runSelfTests(){
  const a1 = splitImport("A,B;C\tD\nE\r\nF"); assert("splitImport", a1.join("|")==="A|B|C|D|E|F");
  const st0 = stateFromNames(["Alpha","Beta"]); const enc=encodeState(st0); const dec=decodeState(enc as string);
  assert("encode/decode", !!dec && typeof dec==="object" && Object.keys(dec.items||{}).length===2);
  const legacy = { rows:["R1","R2"], cols:["C1"], containers:{[POOL_ID]:[]}, items:{} }; const mig=migrateState(legacy);
  assert("migrateState", !!mig && Array.isArray(mig.rows) && typeof mig.rows[0]==="object");
}

export default function Page(){
  const initialState = useMemo<AppState>(()=>{ const hash=typeof window!=='undefined'?window.location.hash.replace(/^#/,""):"";
    if(hash){ const dec=decodeState(hash); const mig=migrateState(dec); if(mig) return mig; }
    if(typeof window!=='undefined'){ const raw=localStorage.getItem("tierlist2d-state"); if(raw){ try{ const mig=migrateState(JSON.parse(raw)); if(mig) return mig; }catch{} } }
    return stateFromNames([]); },[]);
  const [state,setState] = useState<AppState>(initialState);
  const [activeId,setActiveId] = useState<string|null>(null);
  const [importText,setImportText] = useState(""); const [poolQuery,setPoolQuery] = useState("");

  const sensors = useSensors(useSensor(PointerSensor,{activationConstraint:{distance:2}}), useSensor(MouseSensor), useSensor(TouchSensor));
  useEffect(()=>{ try{ localStorage.setItem("tierlist2d-state", JSON.stringify(state)); }catch{} },[state]);
  useEffect(()=>{ try{ const g:any=typeof globalThis!=='undefined'?(globalThis as any):{}; const isDev=!!g.process?.env?.NODE_ENV ? g.process.env.NODE_ENV!=="production" : false; if(isDev){ runSelfTests(); } }catch{} },[]);
  useEffect(()=>{ setState(prev=>{ const containers={...prev.containers};
    for(let r=0;r<prev.rows.length;r++) for(let c=0;c<prev.cols.length;c++) if(!containers[`r${r}-c${c}`]) containers[`r${r}-c${c}`]=[];
    const valid=new Set<string>([prev.poolId]); for(let r=0;r<prev.rows.length;r++) for(let c=0;c<prev.cols.length;c++) valid.add(`r${r}-c${c}`);
    const pool=[...(containers[prev.poolId]||[])]; Object.keys(containers).forEach((k)=>{ if(!valid.has(k)){ pool.push(...containers[k]); delete containers[k]; }});
    containers[prev.poolId]=pool; return {...prev, containers}; }); },[state.rows.length, state.cols.length]);

  const getContainerByItem=(itemId:string)=>{ for(const [cid,arr] of Object.entries(state.containers)) if(arr.includes(itemId)) return cid; return null; };
  function handleDragStart(e:any){ setActiveId(e.active?.id??null); }
  function handleDragOver(e:any){ const {active,over}=e; if(!over) return; const aid=active.id as string; const oid=over.id as string; if(oid===undefined) return;
    const src=getContainerByItem(aid); const dst=oid.startsWith("r")||oid===POOL_ID ? oid : getContainerByItem(oid); if(!src||!dst||src===dst) return;
    setState(prev=>{ const next={...prev, containers:{...prev.containers}} as AppState; const sItems=[...next.containers[src]]; const dItems=[...next.containers[dst]]; const i=sItems.indexOf(aid); if(i>-1) sItems.splice(i,1); dItems.push(aid);
      next.containers[src]=sItems; next.containers[dst]=dItems; return next; }); }
  function handleDragEnd(e:any){ const {active,over}=e; setActiveId(null); if(!over) return; const aid=active.id as string; const oid=over.id as string;
    const src=getContainerByItem(aid); const dst=oid.startsWith("r")||oid===POOL_ID ? oid : getContainerByItem(oid); if(!src||!dst) return;
    if(src===dst){ setState(prev=>{ const items=[...prev.containers[src]]; const oldIndex=items.indexOf(aid); let newIndex=items.indexOf(oid); if(newIndex===-1) newIndex=oldIndex;
      return {...prev, containers:{...prev.containers, [src]: arrayMove(items, oldIndex, newIndex)}} as AppState; }); } }

  function addRow(){ setState(s=>({...s, rows:[...s.rows, {label:`Ligne ${s.rows.length+1}`, color:"#94a3b8"}]})); }
  function addCol(){ setState(s=>({...s, cols:[...s.cols, {label:`Colonne ${s.cols.length+1}`, color:"#94a3b8"}]})); }
  function removeRow(i:number){ setState(s=>({...s, rows:s.rows.filter((_,idx)=>idx!==i)})); }
  function removeCol(i:number){ setState(s=>({...s, cols:s.cols.filter((_,idx)=>idx!==i)})); }
  function renameRow(i:number,v:string){ setState(s=>{ const rows=[...s.rows]; rows[i]={...rows[i], label:v}; return {...s, rows}; }); }
  function recolorRow(i:number,v:string){ setState(s=>{ const rows=[...s.rows]; rows[i]={...rows[i], color:v}; return {...s, rows}; }); }
  function renameCol(i:number,v:string){ setState(s=>{ const cols=[...s.cols]; cols[i]={...cols[i], label:v}; return {...s, cols}; }); }
  function recolorCol(i:number,v:string){ setState(s=>{ const cols=[...s.cols]; cols[i]={...s.cols[i], color:v}; return {...s, cols}; }); }
  function clearGridKeepItems(){ setState(s=>{ const containers=makeEmptyGrid(s.rows.length,s.cols.length); const allIds=Object.values(s.containers).flat(); containers[POOL_ID]=allIds; return {...s, containers}; }); }
  function resetAll(){ setState(stateFromNames([])); history.replaceState(null,"","#"); }
  function exportState(){ try{ const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="tierlist2d_state.json"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),5000);}catch{} }
  function importStateFromFile(file:File){ const reader=new FileReader(); reader.onload=()=>{ try{ const obj=JSON.parse(String(reader.result)); const mig=migrateState(obj); if(mig) setState(mig);}catch{ alert("Fichier invalide"); } }; reader.readAsText(file); }
  function shareURL(copyOnly=true){ const enc=encodeState(state); if(!enc) return; const url=`${location.origin}${location.pathname}#${enc}`; navigator.clipboard?.writeText(url); if(!copyOnly) history.replaceState(null,"",`#${enc}`); alert("Lien copié dans le presse-papiers ✨"); }
  function importNamesFromText(){ const names=splitImport(importText); if(!names.length) return; const newState=stateFromNames(names); setState(s=>({...newState, rows:s.rows, cols:s.cols, forceDark:true})); setImportText(""); }

  const T = DARK;
  const gridTemplate: React.CSSProperties = {
    gridTemplateColumns: "minmax(140px, max-content) " + state.cols.map(()=> "minmax(180px, 1fr)").join(" "),
  };

  const poolIds = state.containers[state.poolId] || [];
  const filteredPoolIds = (poolIds && poolIds.length && poolQuery)
    ? poolIds.filter((id)=> normalizeText(state.items[id]?.name || id).includes(normalizeText(poolQuery)))
    : poolIds;

  ;
  return (
    <div>
      <div className={cx("min-h-screen", T.pageBg, T.pageText)}>
        <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl md:text-3xl font-bold">Tier list 2D – Rap FR</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={clearGridKeepItems} title="Tout renvoyer en bas"><Scissors className="w-4 h-4 mr-2" /> Vider la grille</Button>
              <Button variant="outline" onClick={exportState} title="Exporter l'état en JSON"><Download className="w-4 h-4 mr-2" /> Exporter</Button>
              <label className="inline-flex items-center gap-2 cursor-pointer"><Upload className="w-4 h-4" /><span className="text-sm">Importer .json</span>
                <input type="file" accept="application/json" className="hidden" onChange={(e)=>{ const f=(e.target as HTMLInputElement).files?.[0]; if(f) importStateFromFile(f); (e.currentTarget as HTMLInputElement).value=""; }} /></label>
              <Button onClick={()=>shareURL(false)} title="Mettre l'état dans l'URL et copier le lien"><Link2 className="w-4 h-4 mr-2" /> Partager le lien</Button>
              <Button variant="destructive" onClick={resetAll} title="Réinitialiser complètement"><RefreshCcw className="w-4 h-4 mr-2" /> Réinitialiser</Button>
            </div>
          </div>

          <Card><CardHeader><CardTitle>Axes & options</CardTitle></CardHeader><CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div><Label className="mb-2 block">Axe vertical (lignes) — texte & couleur</Label>
                <div className="space-y-2">{state.rows.map((r,i)=>(
                  <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
                    <Input value={r.label} onChange={(e)=>renameRow(i, e.target.value)} />
                    <input type="color" value={r.color} onChange={(e)=>recolorRow(i, e.target.value)} title="Couleur de la ligne" className="h-10 w-12 rounded cursor-pointer border" />
                    <div className="px-3 py-2 rounded-md text-xs font-semibold text-center" style={{ backgroundColor:r.color, color: textColorForBg(r.color) }} title="Aperçu">Aperçu</div>
                    <Button variant="outline" size="icon" onClick={()=>removeRow(i)} title="Supprimer la ligne"><Trash2 className="w-4 h-4" /></Button>
                  </div>
                ))}<Button onClick={addRow} className="mt-1"><Plus className="w-4 h-4 mr-2" /> Ajouter une ligne</Button></div>
              <div><Label className="mb-2 block">Axe horizontal (colonnes) — texte & couleur</Label>
                <div className="space-y-2">{state.cols.map((c,i)=>(
                  <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
                    <Input value={c.label} onChange={(e)=>renameCol(i, e.target.value)} />
                    <input type="color" value={c.color} onChange={(e)=>recolorCol(i, e.target.value)} title="Couleur de la colonne" className="h-10 w-12 rounded cursor-pointer border" />
                    <div className="px-3 py-2 rounded-md text-xs font-semibold text-center" style={{ backgroundColor:c.color, color: textColorForBg(c.color) }} title="Aperçu">Aperçu</div>
                    <Button variant="outline" size="icon" onClick={()=>removeCol(i)} title="Supprimer la colonne"><Trash2 className="w-4 h-4" /></Button>
                  </div>
                ))}<Button onClick={addCol} className="mt-1"><Plus className="w-4 h-4 mr-2" /> Ajouter une colonne</Button></div>
            </div>
          </CardContent></Card>

          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} modifiers={[restrictToWindowEdges]}>
            <div className={cx("overflow-auto rounded-2xl border", DARK.cardBg, DARK.cardBorder)}>
              <div className="grid gap-2 p-2" style={gridTemplate}>
                <div />
                {state.cols.map((c,ci)=>(
                  <div key={`colh-${ci}`} className={cx("sticky top-0 z-10 rounded-xl p-2 text-sm font-semibold border", DARK.cardBorder)} style={{ backgroundColor:c.color, color:textColorForBg(c.color) }}>{c.label}</div>
                ))}
                {state.rows.map((r,ri)=>(
                  <React.Fragment key={`row-${ri}`}>
                    <div className={cx("sticky left-0 z-10 rounded-xl p-2 text-sm font-semibold border", DARK.cardBorder)} style={{ backgroundColor:r.color, color:textColorForBg(r.color) }}>{r.label}</div>
                    {state.cols.map((_,ci)=>{ const id=`r${ri}-c${ci}`; const items=state.containers[id]||[]; return (
                      <Card key={id} className={cx("w-full h-full border", DARK.cardBorder)}><CardContent className={cx("p-2", DARK.cardBg)}>
                        <Droppable id={id}><SortableContext id={id} items={items} strategy={rectSortingStrategy}>
                          <div className={cx("relative w-full flex flex-wrap gap-2", state.wrapMode==="width" && "whitespace-nowrap overflow-x-auto")} style={{ minHeight:120 }} data-cell-id={id}>
                            {items.map((itemId)=>(<Tile key={itemId} id={itemId} name={state.items[itemId]?.name ?? itemId} tileSize={state.tileSize} />))}
                          </div>
                        </SortableContext></Droppable>
                      </CardContent></Card>
                    );})}
                  </React.Fragment>
                ))}
              </div>
            </div>

            <Card><CardHeader><CardTitle>Bac (non classés)</CardTitle></CardHeader><CardContent className={DARK.cardBg}>
              <div className="flex items-center gap-2 mb-2">
                <Input value={poolQuery} onChange={(e)=>setPoolQuery(e.target.value)} placeholder="Filtrer le bac…" className="max-w-sm" />
                {poolQuery && (<Button variant="outline" size="sm" onClick={()=>setPoolQuery("")}>Effacer</Button>)}
              </div>
              <Droppable id={state.poolId}><SortableContext id={state.poolId} items={filteredPoolIds} strategy={rectSortingStrategy}>
                <div className="flex flex-wrap gap-2 p-2">{filteredPoolIds.map((itemId)=>(<Tile key={itemId} id={itemId} name={state.items[itemId]?.name ?? itemId} tileSize={state.tileSize} />))}</div>
              </SortableContext></Droppable>
            </CardContent></Card>

            <DragOverlay>{activeId ? (<Tile id={activeId} name={state.items[activeId]?.name ?? ""} tileSize={state.tileSize} />) : null}</DragOverlay>
          </DndContext>

          <Card><CardHeader><CardTitle>Importer des noms</CardTitle></CardHeader><CardContent className="space-y-3">
            <p className={cx("text-sm", DARK.mutedText)}>Collez une liste séparée par retours à la ligne / virgules / points-virgules.</p>
            <Textarea rows={6} value={importText} onChange={(e)=>setImportText(e.target.value)} placeholder={"Ex.\\nNinho\\nBooba\\nDinos"} />
            <div className="flex gap-2"><Button onClick={importNamesFromText}><Upload className="w-4 h-4 mr-2" />Ajouter au bac</Button>
              <Button variant="outline" onClick={()=>setImportText("")}><Trash2 className="w-4 h-4 mr-2" />Vider la zone</Button></div>
          </CardContent></Card>

          <div className={cx("text-xs", DARK.mutedText)}><p>Persistance : sauvegarde locale + lien partageable via URL.</p></div>
        </div>
      </div>
    </div>
  );
}
