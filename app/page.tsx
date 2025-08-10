'use client';
import React, { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
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

// =====================
// Types
// =====================

type Item = { id: string; name: string; image?: string };

type Row = { label: string; color: string };
type Col = { label: string; color: string };

type AppState = {
  rows: Row[];
  cols: Col[];
  colWidths: number[]; // px per column
  containers: Record<string, string[]>; // containerId -> item ids
  items: Record<string, Item>; // id -> item
  poolId: string; // id of the pool container
  tileSize: number; // px
  forceDark: boolean; // theme (always true)
};

// =====================
// Utils
// =====================

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

// Palette D (tuile): gris plus clair que le fond
const TILE_BG = "#23242a"; // légèrement plus clair que bg général
const TILE_BORDER = "#3f3f46"; // gris médian

// Remove diacritics & make a slug
const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

function normalizeText(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Alpha sorting helper for pool (French collator, accent-insensitive)
const collator = new Intl.Collator('fr', { sensitivity: 'base', ignorePunctuation: true, numeric: true });
function sortIdsAlpha(ids: string[], items: Record<string, Item>) {
  return [...ids].sort((a, b) => collator.compare(
    normalizeText(items[a]?.name || a),
    normalizeText(items[b]?.name || b)
  ));
}

function textColorForBg(hex: string) {
  try {
    let c = hex.replace("#", "");
    if (c.length === 3) c = c.split("").map((x) => x + x).join("");
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 140 ? "#111827" : "#FFFFFF";
  } catch {
    return "#FFFFFF";
  }
}

function splitImport(text: string): string[] {
  return text
    .split(/\r?\n|,|;|\t/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Parse pairs lines: "Name<TAB/|/,/;>URL" → {name,image}
function parsePairs(text: string): Array<{ name: string; image?: string }> {
  const lines = text.split(/\r?\n/g).map((l) => l.trim()).filter(Boolean);
  const out: Array<{ name: string; image?: string }> = [];
  for (const line of lines) {
    const m = line.match(/https?:\/\/\S+/);
    if (m) {
      const url = m[0];
      const name = line.replace(url, "").split(/[|;,\t]/).join(" ").trim().replace(/\s{2,}/g, " ");
      out.push({ name: name || url, image: url });
    } else {
      out.push({ name: line });
    }
  }
  return out;
}

function cx(...cls: Array<string | false | null | undefined>) {
  return cls.filter(Boolean).join(" ");
}

const DARK = {
  pageBg: "bg-zinc-950",
  pageText: "text-zinc-50",
  cardBg: "bg-zinc-900",
  cardBorder: "border-zinc-800",
  mutedText: "text-zinc-400",
};

// Dark UI utilities
const INPUT_DARK = "bg-zinc-800 text-zinc-100 border-zinc-700 placeholder:text-zinc-400";
const OUTLINE_DARK = "border-zinc-700 text-zinc-100 hover:bg-zinc-800";

// =====================
// Sortable tile (supports image)
// =====================
function Tile({ id, name, image, tileSize, selected, highlighted, onClick }: { id: string; name: string; image?: string; tileSize: number; selected?: boolean; highlighted?: boolean; onClick?: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: tileSize,
    height: tileSize,
    touchAction: "none",
  };
  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout
      data-item-id={id}
      onClick={onClick}
      className={cx(
        "relative overflow-hidden select-none inline-flex items-center justify-center rounded-2xl shadow-sm border p-2 text-sm font-medium cursor-grab active:cursor-grabbing",
        selected ? "ring-2 ring-indigo-400" : highlighted ? "ring-2 ring-amber-400" : "",
        "text-zinc-100",
      )}
      {...attributes}
      {...listeners}
    >
      {/* fond + bordure palette D */}
      <div className="absolute inset-0 rounded-2xl" style={{ backgroundColor: TILE_BG, border: `1px solid ${TILE_BORDER}` }} />
      {image ? (
        <>
          <img
            src={image}
            alt={name}
            referrerPolicy="no-referrer"
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover rounded-2xl"
            onError={(e)=>{ (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1 text-[11px] text-center rounded-b-2xl">
            <span className="font-semibold text-white drop-shadow-sm px-1">{name}</span>
          </div>
        </>
      ) : (
        <span className="relative text-center leading-tight px-1 break-words z-10">{name}</span>
      )}
    </motion.div>
  );
}

// =====================
// Droppable wrapper (click-to-place supported)
// =====================
function Droppable({ id, children, onClick }: { id: string; children: React.ReactNode; onClick?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      data-droppable-id={id}
      onClick={onClick}
      className={cx("min-h-[120px] rounded-md", isOver && "ring-2 ring-indigo-500/60", DARK.cardBg)}
      style={{ touchAction: "none" }}
    >
      {children}
    </div>
  );
}

// =====================
// State helpers
// =====================
function makeEmptyGrid(rowsLen: number, colsLen: number) {
  const containers: Record<string, string[]> = {};
  for (let r = 0; r < rowsLen; r++) {
    for (let c = 0; c < colsLen; c++) {
      containers[`r${r}-c${c}`] = [];
    }
  }
  containers[POOL_ID] = [];
  return containers;
}

function stateFromNames(names: string[]): AppState {
  const items: Record<string, Item> = {};
  const containers = makeEmptyGrid(DEFAULT_ROWS.length, DEFAULT_COLS.length);
  const pool: string[] = [];
  names.forEach((n) => {
    const idBase = slug(n) || Math.random().toString(36).slice(2);
    const id = items[idBase] ? `${idBase}-${Math.random().toString(36).slice(2, 6)}` : idBase;
    items[id] = { id, name: n };
    pool.push(id);
  });
  containers[POOL_ID] = sortIdsAlpha(pool, items);
  return {
    rows: JSON.parse(JSON.stringify(DEFAULT_ROWS)),
    cols: JSON.parse(JSON.stringify(DEFAULT_COLS)),
    colWidths: Array(DEFAULT_COLS.length).fill(220),
    containers,
    items,
    poolId: POOL_ID,
    tileSize: 96,
    forceDark: true,
  };
}

function stateFromEntries(entries: Array<{ name: string; image?: string; id?: string }>): AppState {
  const items: Record<string, Item> = {};
  const containers = makeEmptyGrid(DEFAULT_ROWS.length, DEFAULT_COLS.length);
  const pool: string[] = [];
  entries.forEach(({ name, image, id }) => {
    const base = slug(id || name) || Math.random().toString(36).slice(2);
    const uid = items[base] ? `${base}-${Math.random().toString(36).slice(2, 6)}` : base;
    items[uid] = { id: uid, name, image };
    pool.push(uid);
  });
  containers[POOL_ID] = sortIdsAlpha(pool, items);
  return {
    rows: JSON.parse(JSON.stringify(DEFAULT_ROWS)),
    cols: JSON.parse(JSON.stringify(DEFAULT_COLS)),
    colWidths: Array(DEFAULT_COLS.length).fill(220),
    containers,
    items,
    poolId: POOL_ID,
    tileSize: 96,
    forceDark: true,
  };
}

function encodeState(state: AppState) {
  try {
    return LZString.compressToEncodedURIComponent(JSON.stringify(state));
  } catch (e) {
    console.error(e);
    return "";
  }
}
function decodeState(s: string): any | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(s);
    if (!json) return null;
    return JSON.parse(json);
  } catch (e) {
    console.error(e);
    return null;
  }
}

function migrateState(obj: any): AppState | null {
  if (!obj) return null;
  const rows: Row[] = Array.isArray(obj.rows)
    ? obj.rows.map((r: any, i: number) => (typeof r === "string" ? { label: r, color: DEFAULT_ROWS[i % DEFAULT_ROWS.length].color } : r))
    : DEFAULT_ROWS;
  const cols: Col[] = Array.isArray(obj.cols)
    ? obj.cols.map((c: any, i: number) => (typeof c === "string" ? { label: c, color: DEFAULT_COLS[i % DEFAULT_COLS.length].color } : c))
    : DEFAULT_COLS;

  const containers: Record<string, string[]> = obj.containers || makeEmptyGrid(rows.length, cols.length);
  const items: Record<string, Item> = obj.items || {};
  const poolId = obj.poolId || POOL_ID;
  const tileSize = typeof obj.tileSize === "number" ? obj.tileSize : 96;
  const forceDark = typeof obj.forceDark === "boolean" ? obj.forceDark : true;
  const colWidths: number[] = Array.isArray(obj.colWidths) && obj.colWidths.length === cols.length
    ? obj.colWidths.map((n: any) => (typeof n === "number" ? n : 220))
    : Array(cols.length).fill(220);

  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < cols.length; c++) {
      const id = `r${r}-c${c}`;
      if (!containers[id]) containers[id] = [];
    }
  if (!containers[poolId]) containers[poolId] = [];

  return { rows, cols, colWidths, containers, items, poolId, tileSize, forceDark };
}

// =====================
// Self-tests (dev only, safe in browser)
// =====================
function assert(name: string, cond: boolean) {
  if (cond) console.log(`✅ ${name}`); else console.error(`❌ ${name}`);
}
function runSelfTests() {
  const s1 = splitImport("A,B;C\tD\nE\r\nF");
  assert("splitImport handles , ; \t and newlines", s1.join("|") === "A|B|C|D|E|F");

  const pp = parsePairs("Alpha\thttp://x/a.jpg\nBeta | https://x/b.webp\nGamma");
  assert("parsePairs length", pp.length === 3);
  assert("parsePairs images detected", !!pp[0].image && !!pp[1].image && !pp[2].image);

  const st = stateFromEntries([{ name: "Alpha" }, { name: "Beta", image: "http://x/b.jpg" }]);
  assert("stateFromEntries pool size", (st.containers[st.poolId] || []).length === 2);

  const enc = encodeState(st); const dec = decodeState(enc);
  assert("encode/decode works", !!dec && typeof dec === "object");

  const mig = migrateState({ rows: ["R1"], cols: ["C1"], containers: { [POOL_ID]: [] }, items: {} });
  assert("migrateState basic", !!mig && Array.isArray(mig.rows) && Array.isArray(mig.cols));
}

// =====================
// Main App
// =====================
export default function TierList2D() {
  const initialState = useMemo<AppState>(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    if (hash) {
      const dec = decodeState(hash);
      const mig = migrateState(dec);
      if (mig) return mig;
    }
    if (typeof window !== "undefined") {
      const raw = localStorage.getItem("tierlist2d-state");
      if (raw) {
        try {
          const mig = migrateState(JSON.parse(raw));
          if (mig) return mig;
        } catch {}
      }
    }
    return stateFromNames([]);
  }, []);

  const [state, setState] = useState<AppState>(initialState);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pairsText, setPairsText] = useState("");
  const [autoSyncURL, setAutoSyncURL] = useState(false);
  const [poolQuery, setPoolQuery] = useState("");
  const [clickMode] = useState(true); // always click mode
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [seedInput, setSeedInput] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [loadingSeed, setLoadingSeed] = useState(false);
  const [lastSeedId, setLastSeedId] = useState<string | null>(null);

  const matchedIds = useMemo(() => {
    const q = normalizeText(search);
    if (!q) return new Set<string>();
    const s = new Set<string>();
    for (const [id, it] of Object.entries(state.items)) {
      if (normalizeText(it.name).includes(q)) s.add(id);
    }
    return s;
  }, [state.items, search]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 2 } }),
    useSensor(MouseSensor),
    useSensor(TouchSensor),
  );

  // Load last used seed id (for convenience)
  useEffect(() => {
    try { const sid = localStorage.getItem("tier2d-last-seed-id"); if (sid) setLastSeedId(sid); } catch {}
  }, []);

  // Persist
  useEffect(() => {
    try {
      localStorage.setItem("tierlist2d-state", JSON.stringify(state));
      if (autoSyncURL) {
        const enc = encodeState(state);
        if (enc) history.replaceState(null, "", `#${enc}`);
      }
    } catch {}
  }, [state, autoSyncURL]);

  // If URL has ?seed=XYZ on first load, fetch it
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      const seed = url.searchParams.get('seed');
      if (seed) { loadSeed(seed); }
    } catch {}
  }, []);

  // Dev self-tests (safe env checks)
  useEffect(() => {
    try {
      const g: any = typeof globalThis !== "undefined" ? (globalThis as any) : {};
      const isDev = !!g.process?.env?.NODE_ENV ? g.process.env.NODE_ENV !== "production" : false;
      if (isDev && typeof window !== "undefined") {
        const w: any = window as any;
        if (!w.__tier2d_tests_ran__) {
          w.__tier2d_tests_ran__ = true;
          runSelfTests();
        }
      }
    } catch {}
  }, []);

  // Ensure containers exist after rows/cols edits & keep colWidths in sync
  useEffect(() => {
    setState((prev) => {
      const containers = { ...prev.containers };
      for (let r = 0; r < prev.rows.length; r++)
        for (let c = 0; c < prev.cols.length; c++)
          if (!containers[`r${r}-c${c}`]) containers[`r${r}-c${c}`] = [];

      const valid = new Set<string>([prev.poolId]);
      for (let r = 0; r < prev.rows.length; r++)
        for (let c = 0; c < prev.cols.length; c++) valid.add(`r${r}-c${c}`);

      const pool = [...(containers[prev.poolId] || [])];
      Object.keys(containers).forEach((k) => {
        if (!valid.has(k)) {
          pool.push(...containers[k]);
          delete containers[k];
        }
      });
      containers[prev.poolId] = pool;

      // sync colWidths length
      const colWidths = prev.colWidths.length === prev.cols.length
        ? prev.colWidths
        : Array(prev.cols.length).fill(prev.colWidths[0] ?? 220);

      return { ...prev, containers, colWidths };
    });
  }, [state.rows.length, state.cols.length]);

  const getContainerByItem = (itemId: string) => {
    for (const [cid, arr] of Object.entries(state.containers)) if (arr.includes(itemId)) return cid;
    return null;
  };

  function moveToContainer(itemId: string, containerId: string) {
    setState((prev) => {
      const next = { ...prev, containers: { ...prev.containers } } as AppState;
      const from = getContainerByItem(itemId);
      if (!from) return prev;
      if (!next.containers[containerId]) next.containers[containerId] = [];
      const src = [...next.containers[from]];
      const idx = src.indexOf(itemId);
      if (idx > -1) src.splice(idx, 1);
      next.containers[from] = src;
      next.containers[containerId] = (containerId === next.poolId)
        ? sortIdsAlpha([...(next.containers[containerId] || []), itemId], next.items)
        : [...(next.containers[containerId] || []), itemId];
      return next;
    });
  }

  // DnD handlers (kept but optional)
  function handleDragStart(event: any) { setActiveId(event.active?.id ?? null); }
  function handleDragOver(event: any) {
    const { active, over } = event; if (!over) return;
    const activeId = active.id as string; const overId = over.id as string; if (overId === undefined) return;
    const sourceContainer = getContainerByItem(activeId);
    const destContainer = overId.startsWith("r") || overId === POOL_ID ? overId : getContainerByItem(overId);
    if (!sourceContainer || !destContainer || sourceContainer === destContainer) return;
    setState((prev) => {
      const next = { ...prev, containers: { ...prev.containers } } as AppState;
      const sourceItems = [...next.containers[sourceContainer]]; const destItems = [...next.containers[destContainer]];
      const idx = sourceItems.indexOf(activeId); if (idx > -1) sourceItems.splice(idx, 1); destItems.push(activeId);
      if (destContainer === next.poolId) {
        const sorted = sortIdsAlpha(destItems, next.items);
        destItems.length = 0; destItems.push(...sorted);
      }
      next.containers[sourceContainer] = sourceItems; next.containers[destContainer] = destItems; return next; }); }
  function handleDragEnd(event: any) {
    const { active, over } = event; setActiveId(null); if (!over) return;
    const activeId = active.id as string; const overId = over.id as string;
    const sourceContainer = getContainerByItem(activeId); const destContainer = overId.startsWith("r") || overId === POOL_ID ? overId : getContainerByItem(overId);
    if (!sourceContainer || !destContainer) return;
    if (sourceContainer === destContainer) {
      setState((prev) => {
        if (sourceContainer === prev.poolId) {
          const sorted = sortIdsAlpha([...(prev.containers[sourceContainer] || [])], prev.items);
          return { ...prev, containers: { ...prev.containers, [sourceContainer]: sorted } } as AppState;
        }
        const items = [...(prev.containers[sourceContainer] || [])];
        const oldIndex = items.indexOf(activeId);
        let newIndex = items.indexOf(overId);
        if (newIndex === -1) newIndex = oldIndex;
        return { ...prev, containers: { ...prev.containers, [sourceContainer]: arrayMove(items, oldIndex, newIndex) } } as AppState;
      });
    }
  }


  // UI actions for rows/cols
  function addRow() { setState((s) => ({ ...s, rows: [...s.rows, { label: `Ligne ${s.rows.length + 1}`, color: "#94a3b8" }] })); }
  function addCol() { setState((s) => ({ ...s, cols: [...s.cols, { label: `Colonne ${s.cols.length + 1}`, color: "#94a3b8" }], colWidths: [...s.colWidths, s.colWidths.at(-1) ?? 220] })); }
  function removeRow(i: number) { setState((s) => ({ ...s, rows: s.rows.filter((_, idx) => idx !== i) })); }
  function removeCol(i: number) { setState((s) => ({ ...s, cols: s.cols.filter((_, idx) => idx !== i), colWidths: s.colWidths.filter((_, idx) => idx !== i) })); }
  function renameRow(i: number, v: string) { setState((s) => { const rows = [...s.rows]; rows[i] = { ...rows[i], label: v }; return { ...s, rows }; }); }
  function recolorRow(i: number, v: string) { setState((s) => { const rows = [...s.rows]; rows[i] = { ...rows[i], color: v }; return { ...s, rows }; }); }
  function renameCol(i: number, v: string) { setState((s) => { const cols = [...s.cols]; cols[i] = { ...cols[i], label: v }; return { ...s, cols }; }); }
  function recolorCol(i: number, v: string) { setState((s) => { const cols = [...s.cols]; cols[i] = { ...cols[i], color: v }; return { ...s, cols }; }); }
  function setColWidth(i: number, v: number) { setState((s) => { const cw = [...s.colWidths]; const w = Math.max(140, Math.min(560, Math.round(v))); cw[i] = w; return { ...s, colWidths: cw }; }); }
  function applyColWidthAll(v: number) { setState((s) => ({ ...s, colWidths: Array(s.cols.length).fill(Math.max(140, Math.min(560, Math.round(v)))) })); }
  function clearGridKeepItems() { setState((s) => { const containers = makeEmptyGrid(s.rows.length, s.cols.length); const allIds = Object.values(s.containers).flat(); containers[POOL_ID] = sortIdsAlpha(allIds, s.items); return { ...s, containers }; }); }
  function resetAll() { setState(stateFromNames([])); history.replaceState(null, "", "#"); }
  function exportState() { try { const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "tierlist2d_state.json"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); } catch { alert("Export impossible dans cet environnement."); } }
  function importStateFromFile(file: File) {
    const reader = new FileReader(); reader.onload = () => { try {
      const obj = JSON.parse(String(reader.result));
      if (Array.isArray(obj)) {
        if (obj.length && typeof obj[0] === "object" && obj[0].name) { setState(stateFromEntries(obj)); }
        else { setState(stateFromNames(obj.map(String))); }
        return;
      }
      const mig = migrateState(obj); if (mig) setState(mig);
    } catch { alert("Fichier invalide"); } }; reader.readAsText(file);
  }
  function shareURL(copyOnly = true) {
    const enc = encodeState(state); if (!enc) return;
    const url = `${location.origin}${location.pathname}#${enc}`;
    navigator.clipboard?.writeText(url);
    if (!copyOnly) history.replaceState(null, "", `#${enc}`);
    alert("Lien copié dans le presse-papiers ✨");
  }

  // --- Seed publishing (to Vercel Blob via API) ---
  async function publishSeed(explicitId?: string) {
    try {
      setPublishing(true);
      const encoded = encodeState(state);
      const payload: any = { data: encoded };
      if (explicitId && explicitId.trim()) payload.id = explicitId.trim();
      const res = await fetch('/api/seed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const id: string = j.id;
      setLastSeedId(id);
      try { localStorage.setItem('tier2d-last-seed-id', id); } catch {}
      const share = `${location.origin}${location.pathname}?seed=${encodeURIComponent(id)}`;
      await navigator.clipboard?.writeText(share);
      alert(`Seed publié !
ID: ${id}
Lien copié : ${share}`);
    } catch (e: any) {
      alert(`Échec publication du seed. ${e?.message || ''}
As-tu bien configuré Vercel Blob et la variable BLOB_READ_WRITE_TOKEN ?`);
    } finally { setPublishing(false); }
  }

  async function loadSeed(input: string) {
    try {
      setLoadingSeed(true);
      let url = input.trim();
      // autoriser collage direct de l'URL blob
      if (!/^https?:\/\//i.test(url)) url = `/api/seed/${encodeURIComponent(url)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const dec = decodeState(j.data);
      const mig = migrateState(dec);
      if (mig) {
        setState(mig);
        if (j.id) { setLastSeedId(j.id); try { localStorage.setItem('tier2d-last-seed-id', j.id); } catch {} }
        alert('Seed chargé ✔️');
      } else {
        alert('Seed invalide.');
      }
    } catch (e: any) {
      alert(`Échec chargement du seed. ${e?.message || ''}`);
    } finally { setLoadingSeed(false); }
  }
  function importPairs() {
    const entries = parsePairs(pairsText); if (!entries.length) return;
    const items = { ...state.items }; const pool = [...(state.containers[state.poolId] || [])];
    for (const { name, image } of entries) {
      const base = slug(name) || Math.random().toString(36).slice(2);
      const uid = items[base] ? `${base}-${Math.random().toString(36).slice(2,6)}` : base;
      items[uid] = { id: uid, name, image };
      pool.push(uid);
    }
    setPairsText("");
    setState((s)=> ({ ...s, items, containers: { ...s.containers, [s.poolId]: sortIdsAlpha(pool, items) } }) );
  }

  const T = DARK; // always dark

  function deleteItem(id: string) {
    setState((prev) => {
      const containers = { ...prev.containers };
      for (const [cid, arr] of Object.entries(containers)) {
        const idx = arr.indexOf(id);
        if (idx > -1) {
          const clone = [...arr];
          clone.splice(idx, 1);
          containers[cid] = clone;
        }
      }
      const items = { ...prev.items };
      delete items[id];
      return { ...prev, containers, items } as AppState;
    });
    if (selectedId === id) setSelectedId(null);
  }
  function clearPool() {
    setState((prev) => {
      const pool = prev.containers[prev.poolId] || [];
      const items = { ...prev.items };
      for (const id of pool) delete items[id];
      return { ...prev, items, containers: { ...prev.containers, [prev.poolId]: [] } } as AppState;
    });
  }
  function scrollToFirstMatch() {
    const id = Array.from(matchedIds)[0];
    if (!id) return;
    const el = document.querySelector(`[data-item-id="${id}"]`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      const editing = tag === "input" || tag === "textarea" || (t as any)?.isContentEditable;
      if (editing) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteItem(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  // Grid template: header + dynamic cols (px)
  const colsPx = state.colWidths.map(w => String(w) + "px").join(" ");
const gridTemplate: React.CSSProperties = { gridTemplateColumns: `minmax(140px, max-content) ${colsPx}` };


  // Pool filter
  const poolIds = state.containers[state.poolId] || [];
  const filteredPoolIds = poolQuery ? poolIds.filter((id) => normalizeText(state.items[id]?.name || id).includes(normalizeText(poolQuery))) : poolIds;

  return (
    <div className={cx("min-h-screen", T.pageBg, T.pageText)}>
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl md:text-3xl font-bold">Tier list 2D – Rap FR</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={clearGridKeepItems} title="Tout renvoyer en bas"><Scissors className="w-4 h-4 mr-2" /> Vider la grille</Button>
            <Button variant="outline" className={OUTLINE_DARK} onClick={exportState} title="Exporter l'état en JSON"><Download className="w-4 h-4 mr-2" /> Exporter</Button>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <Upload className="w-4 h-4" />
              <span className="text-sm">Importer .json</span>
              <input type="file" accept="application/json" className="hidden" onChange={(e)=>{ const f = e.target.files?.[0]; if (f) importStateFromFile(f); (e.currentTarget as HTMLInputElement).value = ""; }} />
            </label>
            <Button onClick={() => shareURL(false)} title="Mettre l'état dans l'URL et copier le lien"><Link2 className="w-4 h-4 mr-2" /> Partager le lien</Button>
            <Button variant="destructive" onClick={resetAll} title="Réinitialiser complètement"><RefreshCcw className="w-4 h-4 mr-2" /> Réinitialiser</Button>
            <Input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Rechercher…" className={cx("w-44", INPUT_DARK)} />
            <Button variant="outline" className={OUTLINE_DARK} onClick={scrollToFirstMatch}>Trouver</Button>
            {search && (<Button variant="outline" className={OUTLINE_DARK} onClick={()=>setSearch("")}>Effacer</Button>)}
            {selectedId && (<Button variant="outline" className={OUTLINE_DARK} onClick={() => setSelectedId(null)} title="Annuler la sélection">Annuler sélection</Button>)}
          </div>
        </div>

        {/* Axes & options */}
        <Card>
          <CardHeader>
            <CardTitle>Axes & options</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label className="mb-2 block">Axe vertical (lignes) — texte & couleur</Label>
                <div className="space-y-2">
                  {state.rows.map((r, i) => (
                    <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
                      <Input className={INPUT_DARK} value={r.label} onChange={(e) => renameRow(i, e.target.value)} />
                      <input type="color" value={r.color} onChange={(e) => recolorRow(i, e.target.value)} title="Couleur de la ligne" className="h-10 w-12 rounded cursor-pointer border" />
                      <div className="px-3 py-2 rounded-md text-xs font-semibold text-center" style={{ backgroundColor: r.color, color: textColorForBg(r.color) }} title="Aperçu">Aperçu</div>
                      <Button variant="outline" className={OUTLINE_DARK} size="icon" onClick={() => removeRow(i)} title="Supprimer la ligne"><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  ))}
                  <Button onClick={addRow} className="mt-1"><Plus className="w-4 h-4 mr-2" /> Ajouter une ligne</Button>
                </div>
              </div>
              <div>
                <Label className="mb-2 block">Axe horizontal (colonnes) — texte & couleur</Label>
                <div className="space-y-2">
                  {state.cols.map((c, i) => (
                    <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
                      <Input className={INPUT_DARK} value={c.label} onChange={(e) => renameCol(i, e.target.value)} />
                      <input type="color" value={c.color} onChange={(e) => recolorCol(i, e.target.value)} title="Couleur de la colonne" className="h-10 w-12 rounded cursor-pointer border" />
                      <div className="px-3 py-2 rounded-md text-xs font-semibold text-center" style={{ backgroundColor: c.color, color: textColorForBg(c.color) }} title="Aperçu">Aperçu</div>
                      <Button variant="outline" className={OUTLINE_DARK} size="icon" onClick={() => removeCol(i)} title="Supprimer la colonne"><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  ))}
                  <Button onClick={addCol} className="mt-1"><Plus className="w-4 h-4 mr-2" /> Ajouter une colonne</Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
              <div className="space-y-2">
                <Label>Taille des tuiles (px)</Label>
                <Input className={INPUT_DARK} type="number" min={60} max={200} value={state.tileSize} onChange={(e) => setState((s) => ({ ...s, tileSize: Math.max(60, Math.min(200, Number(e.target.value) || 96)) }))} />
              </div>
              <div className="space-y-2">
                <Label>Largeur des colonnes (glisser pour toutes)</Label>
                <input type="range" min={140} max={560} value={state.colWidths[0] ?? 220} onChange={(e)=>applyColWidthAll(Number(e.target.value)||220)} className="w-full" />
              </div>
              <div className="space-y-2">
                <Label>Largeur par colonne (px)</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {state.cols.map((c, i)=> (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs whitespace-nowrap">{c.label}</span>
                      <Input className={INPUT_DARK} type="number" min={140} max={560} value={state.colWidths[i] ?? 220} onChange={(e)=>setColWidth(i, Number(e.target.value)||220)} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Grid */}
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} modifiers={[restrictToWindowEdges]}>
          <div className={cx("overflow-auto rounded-2xl border", T.cardBg, T.cardBorder)}>
            <div className="grid gap-2 p-2" style={gridTemplate}>
              {/* top-left empty */}
              <div />
              {/* Column headers */}
              {state.cols.map((c, ci) => (
                <div key={`colh-${ci}`} className={cx("sticky top-0 z-10 rounded-xl p-2 text-sm font-semibold border", T.cardBorder)} style={{ backgroundColor: c.color, color: textColorForBg(c.color) }}>{c.label}</div>
              ))}

              {/* Rows */}
              {state.rows.map((r, ri) => (
                <React.Fragment key={`row-${ri}`}>
                  <div className={cx("sticky left-0 z-10 rounded-xl p-2 text-sm font-semibold border", T.cardBorder)} style={{ backgroundColor: r.color, color: textColorForBg(r.color) }}>{r.label}</div>
                  {state.cols.map((_, ci) => {
                    const id = `r${ri}-c${ci}`; const items = state.containers[id] || [];
                    return (
                      <Card key={id} className={cx("w-full h-full border", T.cardBorder, T.cardBg)}>
                        <CardContent className={cx("p-2", T.cardBg)}>
                          <Droppable id={id} onClick={() => selectedId && (moveToContainer(selectedId, id), setSelectedId(null))}>
                            <SortableContext id={id} items={items} strategy={rectSortingStrategy}>
                              <div className={cx("relative w-full flex flex-wrap gap-2")} style={{ minHeight: 120 }} data-cell-id={id}>
                                {items.map((itemId) => (
                                  <Tile key={itemId} id={itemId} name={state.items[itemId]?.name ?? itemId} image={state.items[itemId]?.image} tileSize={state.tileSize} selected={selectedId===itemId} highlighted={matchedIds.has(itemId)} onClick={() => setSelectedId(itemId)} />
                                ))}
                              </div>
                            </SortableContext>
                          </Droppable>
                        </CardContent>
                      </Card>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Pool / Bac */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Bac (non classés)</CardTitle>
              <Button variant="destructive" size="sm" onClick={clearPool}><Trash2 className="w-4 h-4 mr-1" /> Vider le bac</Button>
            </CardHeader>
            <CardContent className={T.cardBg}>
              <div className="flex items-center gap-2 mb-2">
                <Input value={poolQuery} onChange={(e) => setPoolQuery(e.target.value)} placeholder="Filtrer le bac…" className={cx("max-w-sm", INPUT_DARK)} />
                {poolQuery && (<Button variant="outline" className={OUTLINE_DARK} size="sm" onClick={() => setPoolQuery("")}>Effacer</Button>)}
              </div>
              <Droppable id={state.poolId} onClick={() => selectedId && (moveToContainer(selectedId, state.poolId), setSelectedId(null))}>
                <SortableContext id={state.poolId} items={filteredPoolIds} strategy={rectSortingStrategy}>
                  <div className="flex flex-wrap gap-2 p-2">
                    {filteredPoolIds.map((itemId) => (
                      <Tile key={itemId} id={itemId} name={state.items[itemId]?.name ?? itemId} image={state.items[itemId]?.image} tileSize={state.tileSize} selected={selectedId===itemId} highlighted={matchedIds.has(itemId)} onClick={() => setSelectedId(itemId)} />
                    ))}
                  </div>
                </SortableContext>
              </Droppable>
            </CardContent>
          </Card>

          <DragOverlay>
            {activeId ? (
              <Tile id={activeId} name={state.items[activeId]?.name ?? ""} image={state.items[activeId]?.image} tileSize={state.tileSize} />
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Seed sync (Vercel Blob) */}
        <Card>
          <CardHeader><CardTitle>Seed (sauvegarde cloud)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className={cx("text-sm", T.mutedText)}>
              Publier ton état en un seed (ID) sauvegardé côté serveur, pour le recharger sur un autre appareil. Nécessite Vercel Blob configuré.
            </p>
            <div className="flex flex-wrap gap-2 items-center">
              <Input className={INPUT_DARK + " w-64"} placeholder="ID seed ou URL" value={seedInput} onChange={(e)=>setSeedInput(e.target.value)} />
              <Button onClick={()=>publishSeed()} disabled={publishing}>{publishing?"Publication…":"Publier (nouveau seed)"}</Button>
              {lastSeedId && (
                <Button variant="outline" className={OUTLINE_DARK} onClick={()=>publishSeed(lastSeedId)} disabled={publishing} title="Réécrire le dernier seed publié">Mettre à jour le seed</Button>
              )}
              <Button variant="outline" className={OUTLINE_DARK} onClick={()=>loadSeed(seedInput)} disabled={loadingSeed}>{loadingSeed?"Chargement…":"Charger"}</Button>
            </div>
            {lastSeedId && (
              <p className={cx("text-xs", T.mutedText)}>
                Dernier seed utilisé : <code>{lastSeedId}</code> — Lien : {typeof window!=="undefined" && (<code>{`${location.origin}${location.pathname}?seed=${encodeURIComponent(lastSeedId)}`}</code>)}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Import noms + images uniquement */}
        <Card>
          <CardHeader>
            <CardTitle>Importer noms + images</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className={cx("text-sm", T.mutedText)}>
              Une ligne par artiste. Formats acceptés : <code>Nom	URL</code>, <code>Nom | URL</code>, <code>Nom,URL</code>, <code>Nom;URL</code>.
            </p>
            <Textarea className={cx("w-full resize-y", INPUT_DARK)} rows={6} value={pairsText} onChange={(e)=>setPairsText(e.target.value)} placeholder={`Ex.
Nekfeu	https://exemple.com/nekfeu.jpg
PNL | https://exemple.com/pnl.webp`} />
            <div className="flex gap-2">
              <Button onClick={importPairs}><Upload className="w-4 h-4 mr-2" />Ajouter au bac</Button>
              <Button variant="outline" className={OUTLINE_DARK} onClick={() => setPairsText("")}>
                <Trash2 className="w-4 h-4 mr-2" />Vider la zone
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className={cx("text-xs", T.mutedText)}>
          <p>
            Persistance : l'état est sauvegardé dans votre navigateur et peut être encodé dans l'URL (bouton « Partager le lien »). Pour un lien public stable, déployez ce fichier sur GitHub Pages / Netlify / Vercel.
          </p>
        </div>
      </div>
    </div>
  );
}
