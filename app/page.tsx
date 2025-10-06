'use client';
import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { Download, Link2, Plus, RefreshCcw, Upload, Scissors, Trash2, MessageSquare, X, Edit, Filter } from "lucide-react";

type Tier = { label: string; color: string };

type AxisDefinition = {
  id: string;
  label: string;
  tiers: Tier[];
  tierWidths?: number[];
  unclassifiedSize?: number;
};

type Item = {
  id: string;
  name: string;
  image?: string;
  comment?: string;
  axisPositions: Record<string, number | null>;
};

type AppState = {
  axes: AxisDefinition[];
  activeVerticalAxisId: string;
  activeHorizontalAxisId: string;
  containers: Record<string, string[]>;
  items: Record<string, Item>;
  poolId: string;
  tileSize: number;
  forceDark: boolean;
};

const POOL_ID = "__pool__";
const UNCLASSIFIED_INDEX = -1;

const DEFAULT_ROWS: Tier[] = [
  { label: "GOATS", color: "#f59e0b" },
  { label: "Excellent", color: "#22c55e" },
  { label: "Bon", color: "#06b6d4" },
  { label: "Moyen plus", color: "#3b82f6" },
  { label: "Moyen", color: "#a855f7" },
  { label: "Mauvais", color: "#f97316" },
  { label: "Trash", color: "#ef4444" },
];

const DEFAULT_COLS: Tier[] = [
  { label: "Street", color: "#0ea5e9" },
  { label: "Street Love", color: "#ec4899" },
  { label: "Club", color: "#f59e0b" },
  { label: "Boom-bap old-school", color: "#84cc16" },
  { label: "Découpe new-school", color: "#6366f1" },
  { label: "New-wave Electro-Pop", color: "#06b6d4" },
  { label: "Arty", color: "#a855f7" },
  { label: "Autre", color: "#94a3b8" },
];

const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;
const NON_ALNUM_RE = /[^a-z0-9]+/g;
const EDGE_DASH_RE = /(^-|-$)+/g;

const slug = (s: string): string => {
  try {
    return s.toLowerCase().trim()
      .normalize("NFD").replace(COMBINING_MARKS_RE, "")
      .replace(NON_ALNUM_RE, "-")
      .replace(EDGE_DASH_RE, "");
  } catch {
    return s.toLowerCase().trim().replace(NON_ALNUM_RE, "-").replace(EDGE_DASH_RE, "");
  }
};

function normalizeText(s: string) {
  return s.toLowerCase().normalize("NFD").replace(COMBINING_MARKS_RE, "");
}

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

function parsePairs(text: string): Array<{ name: string; image?: string; comment?: string }> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: Array<{ name: string; image?: string; comment?: string }> = [];
  for (const line of lines) {
    const m = line.match(/https?:\/\/\S+/);
    if (m) {
      const url = m[0];
      const before = line.slice(0, m.index as number).trim();
      const name = before.split(/[|;,\t]/).join(" ").replace(/\s{2,}/g, " ").trim();
      const after = line.slice((m.index as number) + url.length);
      let cleaned = after.trim();
      while (cleaned.startsWith("|") || cleaned.startsWith(",") || cleaned.startsWith(";") || 
             cleaned.startsWith(":") || cleaned.startsWith("-") || cleaned.startsWith("–") || cleaned.startsWith("—")) {
        cleaned = cleaned.slice(1).trim();
      }
      out.push({ name: name || url, image: url, comment: cleaned || undefined });
    } else {
      const parts = line.split(/[|;,\t]/);
      const name = (parts[0] || "").trim();
      const comment = parts.slice(1).join(" ").replace(/\s{2,}/g, " ").trim();
      out.push({ name: name || line, comment: comment || undefined });
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

const INPUT_DARK = "bg-zinc-800 text-zinc-100 border-zinc-700 placeholder:text-zinc-400";
const OUTLINE_DARK = "border-zinc-700 text-zinc-100 hover:bg-zinc-800";

const INSTRUCTIONS: string[] = [
  "Votre classement est sauvegardé automatiquement dans CE navigateur (localStorage). Redémarrer l'ordinateur ne supprime pas ces données.",
  "Pour retrouver votre travail sur un autre appareil : utilisez la section 'Seed (sauvegarde cloud)'.",
  "1) Cliquez sur 'Publier (nouveau seed)' : un ID et un lien ?seed=… sont générés. Ajoutez ce lien en favoris ou partagez‑le.",
  "2) Quand vous modifiez la tier list, cliquez sur 'Mettre à jour le seed' pour enregistrer la nouvelle version sous le même ID.",
  "3) Si quelqu'un ouvre votre lien, il voit votre classement. Il peut ensuite cliquer 'Publier (nouveau seed)' pour créer sa propre copie (son ID).",
  "Astuce : le bouton 'Partager le lien' encode l'état DANS l'URL (utile pour de petites listes). Pour 3 500 items, préférez les seeds.",
  "Pensez à exporter un JSON de sauvegarde de temps en temps ('Exporter')."
];

const ALPHA_BUCKETS = ["09","AB","CD","EF","GH","IJ","KL","MN","OP","QR","ST","UV","WX","YZ","Autres"] as const;
type AlphaKey = typeof ALPHA_BUCKETS[number];

function bucketForName(name: string): AlphaKey {
  const normalized = (name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
  const first = normalized.charAt(0);
  if (first >= "0" && first <= "9") return "09";
  const code = first.charCodeAt(0);
  if (code >= 65 && code <= 90) {
    const pairs: [AlphaKey, number, number][] = [
      ["AB",65,66],["CD",67,68],["EF",69,70],["GH",71,72],
      ["IJ",73,74],["KL",75,76],["MN",77,78],["OP",79,80],
      ["QR",81,82],["ST",83,84],["UV",85,86],["WX",87,88],
      ["YZ",89,90],
    ];
    for (const [key, a, b] of pairs) if (code === a || code === b) return key;
  }
  return "Autres";
}

function chipCls(active: boolean) {
  return [
    "px-2 py-1 rounded-md text-xs border",
    active ? "bg-zinc-200 text-zinc-900 border-zinc-300" : "bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-zinc-700",
  ].join(" ");
}
function Tile({
  id, name, image, comment, tileSize, selected, highlighted, onClick, isCommentOpen, onCommentToggle,
  axisPositions, axes, showInfo, onInfoToggle,
}: {
  id: string; name: string; image?: string; comment?: string; tileSize: number;
  selected?: boolean; highlighted?: boolean; onClick?: () => void;
  isCommentOpen?: boolean; onCommentToggle?: (id: string) => void;
  axisPositions?: Record<string, number | null>;
  axes?: AxisDefinition[];
  showInfo?: boolean;
  onInfoToggle?: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: tileSize,
    height: tileSize,
    touchAction: "none",
  };

  const hasPositions = axisPositions && Object.values(axisPositions).some(v => v !== null && v !== -1);

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout
      data-item-id={id}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      className={cx(
        "relative overflow-hidden select-none inline-flex items-center justify-center rounded-2xl shadow-sm border p-2 text-sm font-medium cursor-grab active:cursor-grabbing",
        "bg-zinc-900 border-zinc-700 text-zinc-100",
        selected ? "ring-2 ring-indigo-400" : highlighted ? "ring-2 ring-amber-400" : ""
      )}
      {...attributes}
      {...listeners}
    >
      {image ? (
        <>
          <img
            src={image}
            alt={name}
            referrerPolicy="no-referrer"
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover rounded-2xl"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1 text-[11px] text-center rounded-b-2xl">
            <span className="font-semibold text-white drop-shadow-sm px-1">{name}</span>
          </div>
        </>
      ) : (
        <span className="relative text-center leading-tight px-1 break-words z-10">{name}</span>
      )}

      {hasPositions && (
        <button
          onClick={(e) => { e.stopPropagation(); onInfoToggle?.(id); }}
          className="absolute top-8 right-1 h-6 w-6 inline-flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 transition border border-white/30"
          title="Informations de classement"
        >
          <span className="text-xs font-bold text-white">i</span>
        </button>
      )}

            {showInfo && hasPositions && axes && (
              <div
                className="fixed bg-white text-zinc-900 rounded-lg shadow-xl p-3 text-sm z-50 min-w-[200px] border border-zinc-300"
                style={{
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="font-semibold mb-2 border-b pb-1 text-base">{name}</div>
                <div className="space-y-1">
                  {axes.map(axis => {
                    const pos = axisPositions?.[axis.id];
                    if (pos === null || pos === -1) return null;
                    const tierLabel = axis.tiers[pos]?.label || `Tier ${pos}`;
                    return (
                      <div key={axis.id} className="py-1">
                        <span className="font-medium">{axis.label} :</span> {tierLabel}
                      </div>
                    );
                  })}
                </div>
                <button
                  className="mt-3 w-full px-3 py-1 text-xs rounded-md border border-zinc-300 hover:bg-zinc-100"
                  onClick={(e) => { e.stopPropagation(); onInfoToggle?.(id); }}
                >
                  Fermer
                </button>
              </div>
            )}

      {comment && (
        <button
          onClick={(e) => { e.stopPropagation(); onCommentToggle?.(id); }}
          className="absolute top-1 right-1 h-6 w-6 inline-flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 transition"
          title={isCommentOpen ? "Masquer le commentaire" : "Afficher le commentaire"}
        >
          {isCommentOpen ? <X className="h-3.5 w-3.5 text-zinc-100" /> : <MessageSquare className="h-3.5 w-3.5 text-zinc-100" />}
        </button>
      )}
    </motion.div>
  );
}

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

function makeEmptyContainers(vTiers: number, hTiers: number) {
  const containers: Record<string, string[]> = {};
  for (let r = 0; r < vTiers; r++) {
    for (let c = 0; c < hTiers; c++) {
      containers[`r${r}-c${c}`] = [];
    }
  }
  // Colonnes "À classer" (vertical = -1)
  for (let c = 0; c < hTiers; c++) containers[`r-1-c${c}`] = [];
  // Lignes "À classer" (horizontal = -1)
  for (let r = 0; r < vTiers; r++) containers[`r${r}-c-1`] = [];
  // Coin "À classer" × "À classer"
  containers[`r-1-c-1`] = [];
  containers[POOL_ID] = [];
  return containers;
}

function stateFromNames(names: string[]): AppState {
  const talentAxis: AxisDefinition = {
    id: "talent",
    label: "Talent",
    tiers: JSON.parse(JSON.stringify(DEFAULT_ROWS)),
    unclassifiedSize: 150,
  };
  const styleAxis: AxisDefinition = {
    id: "style",
    label: "Style musical",
    tiers: JSON.parse(JSON.stringify(DEFAULT_COLS)),
    tierWidths: Array(DEFAULT_COLS.length).fill(220),
    unclassifiedSize: 150,
  };

  const items: Record<string, Item> = {};
  const pool: string[] = [];

  names.forEach((n) => {
    const idBase = slug(n) || Math.random().toString(36).slice(2);
    const id = items[idBase] ? `${idBase}-${Math.random().toString(36).slice(2, 6)}` : idBase;
    items[id] = { id, name: n, axisPositions: { talent: null, style: null } };
    pool.push(id);
  });

  const containers = makeEmptyContainers(DEFAULT_ROWS.length, DEFAULT_COLS.length);
  containers[POOL_ID] = sortIdsAlpha(pool, items);

  return {
    axes: [talentAxis, styleAxis],
    activeVerticalAxisId: "talent",
    activeHorizontalAxisId: "style",
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

function migrateOldState(obj: any): AppState | null {
  if (!obj) return null;
  if (obj.axes && Array.isArray(obj.axes)) return obj as AppState;

  const rows = Array.isArray(obj.rows)
    ? obj.rows.map((r: any, i: number) => typeof r === "string" ? { label: r, color: DEFAULT_ROWS[i % DEFAULT_ROWS.length].color } : r)
    : DEFAULT_ROWS;
  const cols = Array.isArray(obj.cols)
    ? obj.cols.map((c: any, i: number) => typeof c === "string" ? { label: c, color: DEFAULT_COLS[i % DEFAULT_COLS.length].color } : c)
    : DEFAULT_COLS;

  const talentAxis: AxisDefinition = {
    id: "talent",
    label: "Talent",
    tiers: rows,
    unclassifiedSize: 150,
  };
  const styleAxis: AxisDefinition = {
    id: "style",
    label: "Style musical",
    tiers: cols,
    tierWidths: Array.isArray(obj.colWidths) && obj.colWidths.length === cols.length
      ? obj.colWidths.map((n: any) => typeof n === "number" ? n : 220)
      : Array(cols.length).fill(220),
    unclassifiedSize: 150,
  };

  const oldItems: Record<string, any> = obj.items || {};
  const items: Record<string, Item> = {};

  for (const [id, oldItem] of Object.entries(oldItems)) {
    const containerWithItem = Object.keys(obj.containers || {}).find(
      k => (obj.containers[k] || []).includes(id)
    );

    let talentPos: number | null = null;
    let stylePos: number | null = null;

    if (containerWithItem && containerWithItem !== POOL_ID) {
      const match = containerWithItem.match(/^r(-?\d+)-c(-?\d+)$/);
      if (match) {
        talentPos = parseInt(match[1]);
        stylePos = parseInt(match[2]);
      }
    }

    items[id] = {
      id,
      name: oldItem.name || id,
      image: oldItem.image,
      comment: oldItem.comment,
      axisPositions: { talent: talentPos, style: stylePos },
    };
  }

  const containers = makeEmptyContainers(rows.length, cols.length);
  containers[POOL_ID] = obj.containers?.[POOL_ID] || [];

  for (const [cid, arr] of Object.entries(obj.containers || {})) {
    if (cid !== POOL_ID && cid.startsWith("r")) {
      containers[cid] = arr as string[];
    }
  }

  return {
    axes: [talentAxis, styleAxis],
    activeVerticalAxisId: "talent",
    activeHorizontalAxisId: "style",
    containers,
    items,
    poolId: POOL_ID,
    tileSize: typeof obj.tileSize === "number" ? obj.tileSize : 96,
    forceDark: true,
  };
}
export default function TierList2D() {
  const initialState = useMemo<AppState>(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    if (hash) {
      const dec = decodeState(hash);
      const mig = migrateOldState(dec);
      if (mig) return mig;
    }
    if (typeof window !== "undefined") {
      const raw = localStorage.getItem("tierlist2d-state");
      if (raw) {
        try {
          const mig = migrateOldState(JSON.parse(raw));
          if (mig) return mig;
        } catch {}
      }
    }
    return stateFromNames([]);
  }, []);

  const [state, setState] = useState<AppState>(initialState);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pairsText, setPairsText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [seedInput, setSeedInput] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [loadingSeed, setLoadingSeed] = useState(false);
  const [lastSeedId, setLastSeedId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(true);
  const [showAxisManager, setShowAxisManager] = useState(false);
  const [openCommentId, setOpenCommentId] = useState<string | null>(null);
  const [isEditingComment, setIsEditingComment] = useState(false);
  const [draftComment, setDraftComment] = useState("");
  const [poolAlpha, setPoolAlpha] = useState<AlphaKey | null>("AB");
  const [editingAxisId, setEditingAxisId] = useState<string | null>(null);
  const [showPartialOnly, setShowPartialOnly] = useState(false);
  const [showInfoId, setShowInfoId] = useState<string | null>(null);

  const commentRef = useRef<HTMLDivElement | null>(null);
  const appRootRef = useRef<HTMLDivElement | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 2 } }),
    useSensor(MouseSensor),
    useSensor(TouchSensor),
  );

  const vAxis = state.axes.find(a => a.id === state.activeVerticalAxisId) || state.axes[0];
  const hAxis = state.axes.find(a => a.id === state.activeHorizontalAxisId) || state.axes[1] || state.axes[0];

  const matchedIds = useMemo(() => {
    const q = normalizeText(search);
    if (!q) return new Set<string>();
    const s = new Set<string>();
    for (const [id, it] of Object.entries(state.items)) {
      if (normalizeText(it.name).includes(q)) s.add(id);
    }
    return s;
  }, [state.items, search]);

  useEffect(() => {
    try {
      localStorage.setItem("tierlist2d-state", JSON.stringify(state));
    } catch {}
  }, [state]);

  useEffect(() => {
    function handleGlobalClick(ev: MouseEvent) {
      const t = ev.target as HTMLElement | null;
      if (!t) return;
      const clickedUseful = t.closest("[data-item-id]") || t.closest("[data-cell-id]") ||
        t.closest("[data-pool-root]") || t.closest("[data-comment-panel]") ||
        t.closest("button,[role='button'],input,textarea,select,a,[contenteditable='true']");
      if (clickedUseful) return;
      setOpenCommentId(null);
      setIsEditingComment(false);
      setSelectedId(null);
    }
    document.addEventListener("click", handleGlobalClick, true);
    return () => document.removeEventListener("click", handleGlobalClick, true);
  }, []);

  useEffect(() => {
    if (!openCommentId) return;
    setIsEditingComment(false);
    setDraftComment(state.items[openCommentId]?.comment ?? "");
  }, [openCommentId, state.items]);

  useEffect(() => {
    try {
      const sid = localStorage.getItem("tier2d-last-seed-id");
      if (sid) setLastSeedId(sid);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      const seed = url.searchParams.get('seed');
      if (seed) loadSeed(seed);
    } catch {}
  }, []);

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

  const getContainerByItem = (itemId: string) => {
    for (const [cid, arr] of Object.entries(state.containers)) if (arr.includes(itemId)) return cid;
    return null;
  };

  // FONCTION CORRIGÉE : Rebuild des containers selon les axes actifs
function rebuildContainersForAxes(
    items: Record<string, Item>,
    vAxisId: string,
    hAxisId: string,
    vTiersCount: number,
    hTiersCount: number
  ) {
    const containers = makeEmptyContainers(vTiersCount, hTiersCount);
    
    for (const [id, item] of Object.entries(items)) {
      const vPos = item.axisPositions[vAxisId];
      const hPos = item.axisPositions[hAxisId];
      
      // Cas 1: Jamais classé (null × null)
      if (vPos === null && hPos === null) {
        containers[POOL_ID].push(id);
        continue;
      }
      
      // Cas 2: À classer sur les deux axes (-1 × -1)
      if (vPos === -1 && hPos === -1) {
        containers[POOL_ID].push(id);
        continue;
      }
      
      // Cas 3: À classer sur un seul axe
      if (vPos === -1 && hPos !== null && hPos >= 0) {
        const cid = `r-1-c${hPos}`;
        containers[cid] = containers[cid] || [];
        containers[cid].push(id);
        continue;
      }
      
      if (hPos === -1 && vPos !== null && vPos >= 0) {
        const cid = `r${vPos}-c-1`;
        containers[cid] = containers[cid] || [];
        containers[cid].push(id);
        continue;
      }
      
      // Cas 4: Position normale valide
      if (vPos !== null && hPos !== null && vPos >= 0 && hPos >= 0 && vPos < vTiersCount && hPos < hTiersCount) {
        const cid = `r${vPos}-c${hPos}`;
        containers[cid] = containers[cid] || [];
        containers[cid].push(id);
        continue;
      }
      
      // Sinon: au pool
      containers[POOL_ID].push(id);
    }
    
    containers[POOL_ID] = sortIdsAlpha(containers[POOL_ID], items);
    return containers;
  }
  
  function moveToContainer(itemId: string, containerId: string) {
    setState((prev) => {
      const next = { ...prev, containers: { ...prev.containers } };
      const from = getContainerByItem(itemId);
      if (!from) return prev;
      
      const src = [...next.containers[from]];
      const idx = src.indexOf(itemId);
      if (idx > -1) src.splice(idx, 1);
      next.containers[from] = src;
      
      if (!next.containers[containerId]) next.containers[containerId] = [];
      next.containers[containerId] = containerId === next.poolId
        ? sortIdsAlpha([...next.containers[containerId], itemId], next.items)
        : [...next.containers[containerId], itemId];

      const items = { ...next.items };
      if (items[itemId]) {
        const axisPositions = { ...items[itemId].axisPositions };
        
        if (containerId !== next.poolId) {
          const match = containerId.match(/^r(-?\d+)-c(-?\d+)$/);
          if (match) {
            const r = parseInt(match[1]);
            const c = parseInt(match[2]);
            
            const wasFullyUnclassified = Object.values(axisPositions).every(v => v === null);
            
            axisPositions[next.activeVerticalAxisId] = r;
            axisPositions[next.activeHorizontalAxisId] = c;
            
            // Si c'était totalement non classé, mettre tous les autres axes à -1
            if (wasFullyUnclassified) {
              for (const axis of next.axes) {
                if (axis.id !== next.activeVerticalAxisId && axis.id !== next.activeHorizontalAxisId) {
                  axisPositions[axis.id] = UNCLASSIFIED_INDEX;
                }
              }
            }
          }
        } else {
          // Retour au pool : remettre les positions des axes actifs à null
          axisPositions[next.activeVerticalAxisId] = null;
          axisPositions[next.activeHorizontalAxisId] = null;
        }
        
        items[itemId] = { ...items[itemId], axisPositions };
      }
      
      return { ...next, items };
    });
  }

  function toggleCommentFor(id: string) {
    if (openCommentId === id) {
      setOpenCommentId(null);
      setIsEditingComment(false);
      return;
    }
    setOpenCommentId(id);
    setSelectedId(null);
    const hasComment = state.items[id]?.comment?.trim();
    if (!hasComment) {
      setIsEditingComment(true);
      setDraftComment("");
    }
  }

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
      return { ...prev, containers, items };
    });
    if (selectedId === id) setSelectedId(null);
    if (openCommentId === id) setOpenCommentId(null);
  }

  function handleDragStart(event: any) {
    setActiveId(event.active?.id ?? null);
  }

  function handleDragOver(event: any) {
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;
    const sourceContainer = getContainerByItem(activeId);
    const destContainer = overId.startsWith("r") || overId === POOL_ID ? overId : getContainerByItem(overId);
    if (!sourceContainer || !destContainer || sourceContainer === destContainer) return;

    setState((prev) => {
      const next = { ...prev, containers: { ...prev.containers } };
      const sourceItems = [...(next.containers[sourceContainer] || [])];
      const destItems = [...(next.containers[destContainer] || [])];
      const idx = sourceItems.indexOf(activeId);
      if (idx > -1) sourceItems.splice(idx, 1);
      destItems.push(activeId);
      next.containers[sourceContainer] = sourceItems;
      next.containers[destContainer] = destContainer === next.poolId
        ? sortIdsAlpha(destItems, next.items)
        : destItems;
      return next;
    });
  }

  function handleDragEnd(event: any) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;
    const sourceContainer = getContainerByItem(activeId);
    const destContainer = overId.startsWith("r") || overId === POOL_ID ? overId : getContainerByItem(overId);
    if (!sourceContainer || !destContainer) return;
    if (sourceContainer === destContainer) {
      setState((prev) => {
        if (sourceContainer === prev.poolId) {
          const sorted = sortIdsAlpha([...prev.containers[sourceContainer]], prev.items);
          return { ...prev, containers: { ...prev.containers, [sourceContainer]: sorted } };
        }
        const items = [...prev.containers[sourceContainer]];
        const oldIndex = items.indexOf(activeId);
        let newIndex = items.indexOf(overId);
        if (newIndex === -1) newIndex = oldIndex;
        return { ...prev, containers: { ...prev.containers, [sourceContainer]: arrayMove(items, oldIndex, newIndex) } };
      });
    }
  }
  function resetAll() {
    setState(stateFromNames([]));
    history.replaceState(null, "", "#");
  }

  function exportState() {
    try {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "tierlist2d_state.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      alert("Export impossible dans cet environnement.");
    }
  }

  function importStateFromFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result));
        if (Array.isArray(obj)) {
          if (obj.length && typeof obj[0] === "object" && obj[0].name) {
            const items: Record<string, Item> = {};
            const pool: string[] = [];
            obj.forEach(({ name, image, comment }: any) => {
              const base = slug(name) || Math.random().toString(36).slice(2);
              const uid = items[base] ? `${base}-${Math.random().toString(36).slice(2, 6)}` : base;
              items[uid] = {
                id: uid,
                name,
                image,
                comment,
                axisPositions: state.axes.reduce((acc, axis) => ({ ...acc, [axis.id]: null }), {}),
              };
              pool.push(uid);
            });
            const containers = makeEmptyContainers(vAxis.tiers.length, hAxis.tiers.length);
            containers[POOL_ID] = sortIdsAlpha(pool, items);
            setState(s => ({ ...s, items, containers }));
          }
          return;
        }
        const mig = migrateOldState(obj);
        if (mig) setState(mig);
      } catch {
        alert("Fichier invalide");
      }
    };
    reader.readAsText(file);
  }

  function shareURL() {
    const enc = encodeState(state);
    if (!enc) return;
    const url = `${location.origin}${location.pathname}#${enc}`;
    navigator.clipboard?.writeText(url);
    alert("Lien copié dans le presse-papiers");
  }

  async function publishSeed(explicitId?: string) {
    try {
      setPublishing(true);
      const encoded = encodeState(state);
      const payload: any = { data: encoded };
      if (explicitId && explicitId.trim()) payload.id = explicitId.trim();
      const res = await fetch('/api/seed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const id: string = j.id;
      setLastSeedId(id);
      try {
        localStorage.setItem('tier2d-last-seed-id', id);
      } catch {}
      const share = `${location.origin}${location.pathname}?seed=${encodeURIComponent(id)}`;
      await navigator.clipboard?.writeText(share);
      alert(`Seed publié !\nID: ${id}\nLien copié : ${share}`);
    } catch (e: any) {
      alert(`Échec publication du seed. ${e?.message || ''}\nAs-tu bien configuré Vercel Blob et la variable BLOB_READ_WRITE_TOKEN ?`);
    } finally {
      setPublishing(false);
    }
  }

  async function loadSeed(input: string) {
    try {
      setLoadingSeed(true);
      let url = input.trim();
      if (!/^https?:\/\//i.test(url)) url = `/api/seed/${encodeURIComponent(url)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const dec = decodeState(j.data);
      const mig = migrateOldState(dec);
      if (mig) {
        setState(mig);
        if (j.id) {
          setLastSeedId(j.id);
          try {
            localStorage.setItem('tier2d-last-seed-id', j.id);
          } catch {}
        }
        alert('Seed chargée');
      } else {
        alert('Seed invalide.');
      }
    } catch (e: any) {
      alert(`Échec chargement du seed. ${e?.message || ''}`);
    } finally {
      setLoadingSeed(false);
    }
  }

  function importPairs() {
    const entries = parsePairs(pairsText);
    if (!entries.length) return;
    const items = { ...state.items };
    const pool = [...(state.containers[state.poolId] || [])];
    for (const { name, image, comment } of entries) {
      const base = slug(name) || Math.random().toString(36).slice(2);
      const uid = items[base] ? `${base}-${Math.random().toString(36).slice(2, 6)}` : base;
      items[uid] = {
        id: uid,
        name,
        image,
        comment,
        axisPositions: state.axes.reduce((acc, axis) => ({ ...acc, [axis.id]: null }), {}),
      };
      pool.push(uid);
    }
    setPairsText("");
    setState((s) => ({
      ...s,
      items,
      containers: { ...s.containers, [s.poolId]: sortIdsAlpha(pool, items) },
    }));
  }

  function createNewAxis() {
    const newId = `axis-${Date.now()}`;
    const newAxis: AxisDefinition = {
      id: newId,
      label: `Nouvel axe ${state.axes.length + 1}`,
      tiers: [
        { label: "Tier 1", color: "#22c55e" },
        { label: "Tier 2", color: "#3b82f6" },
        { label: "Tier 3", color: "#ef4444" },
      ],
      tierWidths: [220, 220, 220],
      unclassifiedSize: 150,
    };
    setState(prev => {
      const items = { ...prev.items };
      for (const id in items) {
        const hasAnyPosition = Object.values(items[id].axisPositions)
          .some(v => v !== null);
        items[id] = {
          ...items[id],
          axisPositions: { 
            ...items[id].axisPositions, 
            [newId]: hasAnyPosition ? UNCLASSIFIED_INDEX : null
          },
        };
      }
      return { ...prev, axes: [...prev.axes, newAxis], items };
    });
  }

  function deleteAxis(axisId: string) {
    if (state.axes.length <= 2) {
      alert("Vous devez conserver au moins 2 axes");
      return;
    }
    if (axisId === state.activeVerticalAxisId || axisId === state.activeHorizontalAxisId) {
      alert("Impossible de supprimer un axe actif. Changez d'abord les axes affichés.");
      return;
    }
    setState(prev => {
      const items = { ...prev.items };
      for (const id in items) {
        const axisPositions = { ...items[id].axisPositions };
        delete axisPositions[axisId];
        items[id] = { ...items[id], axisPositions };
      }
      return { ...prev, axes: prev.axes.filter(a => a.id !== axisId), items };
    });
  }

  function updateAxisLabel(axisId: string, label: string) {
    setState(prev => ({
      ...prev,
      axes: prev.axes.map(a => a.id === axisId ? { ...a, label } : a),
    }));
  }

  function addTierToAxis(axisId: string) {
    setState(prev => {
      const newAxes = prev.axes.map(a => {
        if (a.id !== axisId) return a;
        const newTiers = [...a.tiers, { label: `Tier ${a.tiers.length + 1}`, color: "#94a3b8" }];
        const newWidths = a.tierWidths ? [...a.tierWidths, 220] : undefined;
        return { ...a, tiers: newTiers, tierWidths: newWidths };
      });
      
      // Reconstruit les containers si l'axe modifié est actif
      if (axisId === prev.activeVerticalAxisId || axisId === prev.activeHorizontalAxisId) {
        const vAxis = newAxes.find(a => a.id === prev.activeVerticalAxisId)!;
        const hAxis = newAxes.find(a => a.id === prev.activeHorizontalAxisId)!;
        const containers = rebuildContainersForAxes(
          prev.items,
          prev.activeVerticalAxisId,
          prev.activeHorizontalAxisId,
          vAxis.tiers.length,
          hAxis.tiers.length
        );
        return { ...prev, axes: newAxes, containers };
      }
      
      return { ...prev, axes: newAxes };
    });
  }

  function removeTierFromAxis(axisId: string, tierIndex: number) {
    setState(prev => {
      const axis = prev.axes.find(a => a.id === axisId);
      if (!axis || axis.tiers.length <= 1) {
        alert("Un axe doit avoir au moins 1 tier");
        return prev;
      }
      
      // Déplacer les items du tier supprimé vers "À classer"
      const items = { ...prev.items };
      for (const id in items) {
        if (items[id].axisPositions[axisId] === tierIndex) {
          items[id] = {
            ...items[id],
            axisPositions: { ...items[id].axisPositions, [axisId]: UNCLASSIFIED_INDEX }
          };
        } else if (items[id].axisPositions[axisId] !== null && 
                   items[id].axisPositions[axisId]! > tierIndex) {
          // Décaler les indices supérieurs
          items[id] = {
            ...items[id],
            axisPositions: { ...items[id].axisPositions, [axisId]: items[id].axisPositions[axisId]! - 1 }
          };
        }
      }
      
      const newAxes = prev.axes.map(a => {
        if (a.id !== axisId) return a;
        const newTiers = a.tiers.filter((_, i) => i !== tierIndex);
        const newWidths = a.tierWidths ? a.tierWidths.filter((_, i) => i !== tierIndex) : undefined;
        return { ...a, tiers: newTiers, tierWidths: newWidths };
      });
      
      // Reconstruit les containers si l'axe modifié est actif 
      if (axisId === prev.activeVerticalAxisId || axisId === prev.activeHorizontalAxisId) {
        const vAxis = newAxes.find(a => a.id === prev.activeVerticalAxisId)!;
        const hAxis = newAxes.find(a => a.id === prev.activeHorizontalAxisId)!;
        const containers = rebuildContainersForAxes(
          items,
          prev.activeVerticalAxisId,
          prev.activeHorizontalAxisId,
          vAxis.tiers.length,
          hAxis.tiers.length
        );
        return { ...prev, axes: newAxes, items, containers };
      }
      
      return { ...prev, axes: newAxes, items };
    });
  }

  function updateTier(axisId: string, tierIndex: number, updates: Partial<Tier>) {
    setState(prev => ({
      ...prev,
      axes: prev.axes.map(a => {
        if (a.id !== axisId) return a;
        const newTiers = a.tiers.map((t, i) => i === tierIndex ? { ...t, ...updates } : t);
        return { ...a, tiers: newTiers };
      }),
    }));
  }

  // FONCTION CORRIGÉE : Switch vertical axis avec rebuild
  function switchVerticalAxis(newId: string) {
    if (newId === state.activeHorizontalAxisId) {
      alert("L'axe vertical ne peut pas être le même que l'axe horizontal");
      return;
    }
    setState(prev => {
          // DEBUG: Afficher les positions d'un item
    const firstItemId = Object.keys(prev.items)[0];
    if (firstItemId) {
      console.log("Item:", firstItemId);
      console.log("Positions:", prev.items[firstItemId].axisPositions);
      console.log("Cherche vAxis:", newId, "hAxis:", prev.activeHorizontalAxisId);
    }
      const vAxis = prev.axes.find(a => a.id === newId)!;
      const hAxis = prev.axes.find(a => a.id === prev.activeHorizontalAxisId)!;
      const containers = rebuildContainersForAxes(
        prev.items,
        newId,
        prev.activeHorizontalAxisId,
        vAxis.tiers.length,
        hAxis.tiers.length
      );
      return { ...prev, activeVerticalAxisId: newId, containers };
    });
  }

  // FONCTION CORRIGÉE : Switch horizontal axis avec rebuild
  function switchHorizontalAxis(newId: string) {
    if (newId === state.activeVerticalAxisId) {
      alert("L'axe horizontal ne peut pas être le même que l'axe vertical");
      return;
    }
    setState(prev => {
      const vAxis = prev.axes.find(a => a.id === prev.activeVerticalAxisId)!;
      const hAxis = prev.axes.find(a => a.id === newId)!;
      const containers = rebuildContainersForAxes(
        prev.items,
        prev.activeVerticalAxisId,
        newId,
        vAxis.tiers.length,
        hAxis.tiers.length
      );
      return { ...prev, activeHorizontalAxisId: newId, containers };
    });
  }

  const T = DARK;

  const vUnclassifiedSize = vAxis.unclassifiedSize || 150;
  const hUnclassifiedSize = hAxis.unclassifiedSize || 150;

  const colsPx = (hAxis.tierWidths || Array(hAxis.tiers.length).fill(220))
    .map(w => `${w}px`)
    .join(" ");

  const gridTemplate: React.CSSProperties = {
    gridTemplateColumns: `minmax(140px, max-content) ${hUnclassifiedSize}px ${colsPx}`,
  };

  const poolIds = state.containers[state.poolId] || [];
  
  const filteredPoolIds = showPartialOnly
    ? poolIds.filter(id => {
        const positions = state.items[id]?.axisPositions || {};
        return Object.values(positions).some(v => v === UNCLASSIFIED_INDEX);
      })
    : poolIds;

  const showAlphaNav = poolIds.length > 1000;

  const alphaFilteredPoolIds = poolAlpha
    ? filteredPoolIds.filter((id) => bucketForName(state.items[id]?.name || id) === poolAlpha)
    : filteredPoolIds;
  
  const partialCount = poolIds.filter(id => {
    const positions = state.items[id]?.axisPositions || {};
    return Object.values(positions).some(v => v === UNCLASSIFIED_INDEX);
  }).length;

  console.log("partialCount:", partialCount); // ← Cette ligne doit être là
  console.log("poolIds length:", poolIds.length); // ← Et celle-ci aussi
  
 return (
    <div ref={appRootRef} className={cx("min-h-screen", T.pageBg, T.pageText)}>
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl md:text-3xl font-bold">Tier list 2D — Rap FR</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                const vAxis = state.axes.find(a => a.id === state.activeVerticalAxisId)!;
                const hAxis = state.axes.find(a => a.id === state.activeHorizontalAxisId)!;
                const containers = rebuildContainersForAxes(
                  state.items,
                  state.activeVerticalAxisId,
                  state.activeHorizontalAxisId,
                  vAxis.tiers.length,
                  hAxis.tiers.length
                );
                // Remettre tous les items au pool
                const allIds = Object.keys(state.items);
                containers[state.poolId] = sortIdsAlpha(allIds, state.items);
                for (const key in containers) {
                  if (key !== state.poolId) containers[key] = [];
                }
                setState(s => ({ ...s, containers }));
              }}
              title="Tout renvoyer en bas"
            >
              <Scissors className="w-4 h-4 mr-2" /> Vider la grille
            </Button>
            <Button variant="outline" className={OUTLINE_DARK} onClick={exportState}>
              <Download className="w-4 h-4 mr-2" /> Exporter
            </Button>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <Upload className="w-4 h-4" />
              <span className="text-sm">Importer .json</span>
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importStateFromFile(f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <Button onClick={shareURL}>
              <Link2 className="w-4 h-4 mr-2" /> Partager le lien
            </Button>
            <Button variant="destructive" onClick={resetAll}>
              <RefreshCcw className="w-4 h-4 mr-2" /> Réinitialiser
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="flex items-center justify-between gap-2">
            <CardTitle>Mode d'emploi / Sauvegarde & partage</CardTitle>
            <Button variant="outline" className={OUTLINE_DARK} size="sm" onClick={() => setShowHelp(v => !v)}>
              {showHelp ? "Masquer" : "Afficher"}
            </Button>
          </CardHeader>
          {showHelp && (
            <CardContent className="space-y-4">
              <ul className={cx("text-sm list-disc pl-5", T.mutedText)}>
                {INSTRUCTIONS.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className={INPUT_DARK + " w-56"}
                  placeholder="ID de la seed ou URL"
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value)}
                />
                <Button variant="outline" className={OUTLINE_DARK} disabled={loadingSeed} onClick={() => loadSeed(seedInput)}>
                  {loadingSeed ? "Chargement…" : "Charger seed"}
                </Button>
                <Button variant="outline" className={OUTLINE_DARK} disabled={publishing} onClick={() => publishSeed()}>
                  {publishing ? "Publication…" : "Publier (nouvelle seed)"}
                </Button>
                <Button
                  variant="outline"
                  className={OUTLINE_DARK}
                  disabled={publishing || !lastSeedId}
                  onClick={() => lastSeedId && publishSeed(lastSeedId)}
                >
                  {publishing ? "Mise à jour…" : "Mettre à jour la seed"}
                </Button>
                {lastSeedId && <span className={cx("text-xs", T.mutedText)}>Dernier seed : <code>{lastSeedId}</code></span>}
              </div>
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between gap-2">
            <CardTitle>Gestion des axes</CardTitle>
            <Button variant="outline" className={OUTLINE_DARK} size="sm" onClick={() => setShowAxisManager(v => !v)}>
              {showAxisManager ? "Masquer" : "Afficher"}
            </Button>
          </CardHeader>
          {showAxisManager && (
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="mb-2 block">Axe vertical actif</Label>
                  <select
                    className={cx("w-full p-2 rounded", INPUT_DARK)}
                    value={state.activeVerticalAxisId}
                    onChange={(e) => switchVerticalAxis(e.target.value)}
                  >
                    {state.axes.map(axis => (
                      <option key={axis.id} value={axis.id}>{axis.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="mb-2 block">Axe horizontal actif</Label>
                  <select
                    className={cx("w-full p-2 rounded", INPUT_DARK)}
                    value={state.activeHorizontalAxisId}
                    onChange={(e) => switchHorizontalAxis(e.target.value)}
                  >
                    {state.axes.map(axis => (
                      <option key={axis.id} value={axis.id}>{axis.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <Label className="mb-2 block">Axes disponibles</Label>
                <div className="space-y-2">
                  {state.axes.map(axis => (
                    <div key={axis.id} className="flex items-center gap-2 p-2 rounded border border-zinc-700">
                      <div className="flex-1">
                        <div className="font-semibold">{axis.label}</div>
                        <div className={cx("text-xs", T.mutedText)}>{axis.tiers.length} tiers</div>
                      </div>
                      <Button
                        variant="outline"
                        className={OUTLINE_DARK}
                        size="sm"
                        onClick={() => setEditingAxisId(axis.id)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        className={OUTLINE_DARK}
                        size="sm"
                        onClick={() => deleteAxis(axis.id)}
                        disabled={state.axes.length <= 2}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button onClick={createNewAxis} className="mt-2">
                  <Plus className="w-4 h-4 mr-2" /> Créer un axe
                </Button>
              </div>

              {editingAxisId && (() => {
                const axis = state.axes.find(a => a.id === editingAxisId);
                if (!axis) return null;
                return (
                  <Card className="border-2 border-indigo-500">
                    <CardHeader>
                      <CardTitle>Éditer : {axis.label}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <Label>Nom de l'axe</Label>
                        <Input
                          className={INPUT_DARK}
                          value={axis.label}
                          onChange={(e) => updateAxisLabel(axis.id, e.target.value)}
                        />
                      </div>
                      <div>
                        <Label>Tiers de cet axe</Label>
                        <div className="space-y-2 mt-2">
                          {axis.tiers.map((tier, i) => (
                            <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
                              <Input
                                className={INPUT_DARK}
                                value={tier.label}
                                onChange={(e) => updateTier(axis.id, i, { label: e.target.value })}
                              />
                              <input
                                type="color"
                                value={tier.color}
                                onChange={(e) => updateTier(axis.id, i, { color: e.target.value })}
                                className="h-10 w-12 rounded cursor-pointer border"
                              />
                              <div
                                className="px-3 py-2 rounded-md text-xs font-semibold"
                                style={{ backgroundColor: tier.color, color: textColorForBg(tier.color) }}
                              >
                                Aperçu
                              </div>
                              <Button
                                variant="outline"
                                className={OUTLINE_DARK}
                                size="icon"
                                onClick={() => removeTierFromAxis(axis.id, i)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          ))}
                          <Button onClick={() => addTierToAxis(axis.id)} size="sm">
                            <Plus className="w-4 h-4 mr-2" /> Ajouter un tier
                          </Button>
                        </div>
                      </div>
                      <Button onClick={() => setEditingAxisId(null)}>Fermer</Button>
                    </CardContent>
                  </Card>
                );
              })()}
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actions sur les tuiles</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className={INPUT_DARK + " w-44"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher…"
              />
              <Button
                variant="outline"
                className={OUTLINE_DARK}
                onClick={() => {
                  const id = Array.from(matchedIds)[0];
                  if (!id) return;
                  const el = document.querySelector(`[data-item-id="${id}"]`) as HTMLElement | null;
                  el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
                }}
              >
                Trouver
              </Button>
              {search && (
                <Button variant="outline" className={OUTLINE_DARK} onClick={() => setSearch("")}>
                  Effacer
                </Button>
              )}
              <div className="w-px h-6 bg-zinc-700 mx-1" />
              <Button
                variant="outline"
                className={OUTLINE_DARK}
                disabled={!selectedId}
                onClick={() => selectedId && toggleCommentFor(selectedId)}
              >
                Ajouter / ouvrir un commentaire
              </Button>
              <Button
               variant="outline"
               className={OUTLINE_DARK}
               onClick={() => setShowInfoId(null)}
              >
               Masquer les infos
              </Button>
              <Button
                variant="outline"
                className={OUTLINE_DARK}
                disabled={!selectedId || !state.items[selectedId]?.comment}
                onClick={() => {
                  if (!selectedId) return;
                  setState(prev => {
                    const items = { ...prev.items };
                    if (items[selectedId]) {
                      items[selectedId] = { ...items[selectedId], comment: undefined };
                    }
                    return { ...prev, items };
                  });
                  if (openCommentId === selectedId) setOpenCommentId(null);
                }}
              >
                Supprimer le commentaire
              </Button>
              <Button
                variant="outline"
                className={OUTLINE_DARK}
                disabled={!selectedId}
                onClick={() => selectedId && deleteItem(selectedId)}
              >
                Supprimer la tuile
              </Button>
            </div>
          </CardContent>
        </Card>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} modifiers={[restrictToWindowEdges]}>
          <div className={cx("overflow-auto rounded-2xl border", T.cardBg, T.cardBorder)}>
            <div className="grid gap-2 p-2" style={gridTemplate}>
              <div />
              
              <div
                className={cx("sticky top-0 z-10 rounded-xl p-2 text-sm font-semibold border", T.cardBorder)}
                style={{ backgroundColor: "#6b7280", color: "#ffffff" }}
              >
                À classer
              </div>
              {hAxis.tiers.map((tier, ci) => (
                <div
                  key={`colh-${ci}`}
                  className={cx("sticky top-0 z-10 rounded-xl p-2 text-sm font-semibold border", T.cardBorder)}
                  style={{ backgroundColor: tier.color, color: textColorForBg(tier.color) }}
                >
                  {tier.label}
                </div>
              ))}

              <div
                className={cx("sticky left-0 z-10 rounded-xl p-2 text-sm font-semibold border", T.cardBorder)}
                style={{ backgroundColor: "#6b7280", color: "#ffffff" }}
              >
                À classer
              </div>
              
              {(() => {
                const id = `r-1-c-1`;
                const items = state.containers[id] || [];
                return (
                  <Card key={id} className={cx("w-full h-full border", T.cardBorder)}>
                    <CardContent className={cx("p-2", T.cardBg)}>
                      <SortableContext items={items} strategy={rectSortingStrategy}>
                        <Droppable
                          id={id}
                          onClick={() => {
                            if (!selectedId) return;
                            const currentContainer = getContainerByItem(selectedId);
                            if (currentContainer === id) {
                              setSelectedId(null);
                              return;
                            }
                            moveToContainer(selectedId, id);
                          }}
                        >
                          <div className="relative w-full flex flex-wrap gap-2" style={{ minHeight: 120 }} data-cell-id={id}>
                            {items.map((itemId) => (
                              <Tile
                                key={itemId}
                                id={itemId}
                                name={state.items[itemId]?.name ?? itemId}
                                image={state.items[itemId]?.image}
                                comment={state.items[itemId]?.comment}
                                tileSize={state.tileSize}
                                selected={selectedId === itemId}
                                highlighted={matchedIds.has(itemId)}
                                onClick={() => setSelectedId(itemId)}
                                isCommentOpen={openCommentId === itemId}
                                onCommentToggle={toggleCommentFor}
                                axisPositions={state.items[itemId]?.axisPositions}
                                axes={state.axes}
                                showInfo={showInfoId === itemId}
                                onInfoToggle={(id) => setShowInfoId(prev => prev === id ? null : id)}
                              />
                            ))}
                          </div>
                        </Droppable>
                      </SortableContext>
                    </CardContent>
                  </Card>
                );
              })()}

              {hAxis.tiers.map((_, ci) => {
                const id = `r-1-c${ci}`;
                const items = state.containers[id] || [];
                return (
                  <Card key={id} className={cx("w-full h-full border", T.cardBorder)}>
                    <CardContent className={cx("p-2", T.cardBg)}>
                      <SortableContext items={items} strategy={rectSortingStrategy}>
                        <Droppable
                          id={id}
                          onClick={() => {
                            if (!selectedId) return;
                            const currentContainer = getContainerByItem(selectedId);
                            if (currentContainer === id) {
                              setSelectedId(null);
                              return;
                            }
                            moveToContainer(selectedId, id);
                          }}
                        >
                          <div className="relative w-full flex flex-wrap gap-2" style={{ minHeight: 120 }} data-cell-id={id}>
                            {items.map((itemId) => (
                              <Tile
                                key={itemId}
                                id={itemId}
                                name={state.items[itemId]?.name ?? itemId}
                                image={state.items[itemId]?.image}
                                comment={state.items[itemId]?.comment}
                                tileSize={state.tileSize}
                                selected={selectedId === itemId}
                                highlighted={matchedIds.has(itemId)}
                                onClick={() => setSelectedId(itemId)}
                                isCommentOpen={openCommentId === itemId}
                                onCommentToggle={toggleCommentFor}
                                axisPositions={state.items[itemId]?.axisPositions}
                                axes={state.axes}
                                showInfo={showInfoId === itemId}
                                onInfoToggle={(id) => setShowInfoId(prev => prev === id ? null : id)}
                              />
                            ))}
                          </div>
                        </Droppable>
                      </SortableContext>
                    </CardContent>
                  </Card>
                );
              })}

              {vAxis.tiers.map((rowTier, ri) => (
                <React.Fragment key={`row-${ri}`}>
                  <div
                    className={cx("sticky left-0 z-10 rounded-xl p-2 text-sm font-semibold border", T.cardBorder)}
                    style={{ backgroundColor: rowTier.color, color: textColorForBg(rowTier.color) }}
                  >
                    {rowTier.label}
                  </div>

                  {(() => {
                    const id = `r${ri}-c-1`;
                    const items = state.containers[id] || [];
                    return (
                      <Card key={id} className={cx("w-full h-full border", T.cardBorder)}>
                        <CardContent className={cx("p-2", T.cardBg)}>
                          <SortableContext items={items} strategy={rectSortingStrategy}>
                            <Droppable
                              id={id}
                              onClick={() => {
                                if (!selectedId) return;
                                const currentContainer = getContainerByItem(selectedId);
                                if (currentContainer === id) {
                                  setSelectedId(null);
                                  return;
                                }
                                moveToContainer(selectedId, id);
                              }}
                            >
                              <div className="relative w-full flex flex-wrap gap-2" style={{ minHeight: 120 }} data-cell-id={id}>
                                {items.map((itemId) => (
                              <Tile
                                key={itemId}
                                id={itemId}
                                name={state.items[itemId]?.name ?? itemId}
                                image={state.items[itemId]?.image}
                                comment={state.items[itemId]?.comment}
                                tileSize={state.tileSize}
                                selected={selectedId === itemId}
                                highlighted={matchedIds.has(itemId)}
                                onClick={() => setSelectedId(itemId)}
                                isCommentOpen={openCommentId === itemId}
                                onCommentToggle={toggleCommentFor}
                                axisPositions={state.items[itemId]?.axisPositions}
                                axes={state.axes}
                                showInfo={showInfoId === itemId}
                                onInfoToggle={(id) => setShowInfoId(prev => prev === id ? null : id)}
                                  />
                                ))}
                              </div>
                            </Droppable>
                          </SortableContext>
                        </CardContent>
                      </Card>
                    );
                  })()}

                  {hAxis.tiers.map((_, ci) => {
                    const id = `r${ri}-c${ci}`;
                    const items = state.containers[id] || [];
                    return (
                      <Card key={id} className={cx("w-full h-full border", T.cardBorder)}>
                        <CardContent className={cx("p-2", T.cardBg)}>
                          <SortableContext items={items} strategy={rectSortingStrategy}>
                            <Droppable
                              id={id}
                              onClick={() => {
                                if (!selectedId) return;
                                const currentContainer = getContainerByItem(selectedId);
                                if (currentContainer === id) {
                                  setSelectedId(null);
                                  return;
                                }
                                moveToContainer(selectedId, id);
                              }}
                            >
                              <div className="relative w-full flex flex-wrap gap-2" style={{ minHeight: 120 }} data-cell-id={id}>
                                {items.map((itemId) => (
                              <Tile
                                key={itemId}
                                id={itemId}
                                name={state.items[itemId]?.name ?? itemId}
                                image={state.items[itemId]?.image}
                                comment={state.items[itemId]?.comment}
                                tileSize={state.tileSize}
                                selected={selectedId === itemId}
                                highlighted={matchedIds.has(itemId)}
                                onClick={() => setSelectedId(itemId)}
                                isCommentOpen={openCommentId === itemId}
                                onCommentToggle={toggleCommentFor}
                                axisPositions={state.items[itemId]?.axisPositions}
                                axes={state.axes}
                                showInfo={showInfoId === itemId}
                                onInfoToggle={(id) => setShowInfoId(prev => prev === id ? null : id)}
                                  />
                                ))}
                              </div>
                            </Droppable>
                          </SortableContext>
                        </CardContent>
                      </Card>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Bac (non classés)</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                {partialCount > 0 && (
                  <Button
                    variant="outline"
                    className={OUTLINE_DARK}
                    size="sm"
                    onClick={() => setShowPartialOnly(v => !v)}
                  >
                    <Filter className="w-4 h-4 mr-2" />
                    {showPartialOnly ? `Tous (${poolIds.length})` : `Partiels (${partialCount})`}
                  </Button>
                )}
                {showAlphaNav && (
                  <>
                    <button className={chipCls(poolAlpha === null)} onClick={() => setPoolAlpha(null)}>Tous</button>
                    {ALPHA_BUCKETS.map((k) => (
                      <button
                        key={k}
                        className={chipCls(poolAlpha === k)}
                        onClick={() => setPoolAlpha(prev => prev === k ? null : k)}
                      >
                        {k === "Autres" ? "Autres" : `${k[0]}–${k[1]}`}
                      </button>
                    ))}
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent className={T.cardBg}>
              <SortableContext items={alphaFilteredPoolIds} strategy={rectSortingStrategy}>
                <Droppable id={state.poolId}>
                  <div
                    data-pool-root="1"
                    className="flex flex-wrap gap-2 p-2"
                    onClick={(e) => {
                      if ((e.target as HTMLElement)?.closest?.("[data-item-id]")) return;
                      if (!selectedId) return;
                      const currentContainer = getContainerByItem(selectedId);
                      if (currentContainer === state.poolId) {
                        setSelectedId(null);
                        return;
                      }
                      moveToContainer(selectedId, state.poolId);
                    }}
                  >
                    {alphaFilteredPoolIds.map((itemId) => (
                              <Tile
                                key={itemId}
                                id={itemId}
                                name={state.items[itemId]?.name ?? itemId}
                                image={state.items[itemId]?.image}
                                comment={state.items[itemId]?.comment}
                                tileSize={state.tileSize}
                                selected={selectedId === itemId}
                                highlighted={matchedIds.has(itemId)}
                                onClick={() => setSelectedId(itemId)}
                                isCommentOpen={openCommentId === itemId}
                                onCommentToggle={toggleCommentFor}
                                axisPositions={state.items[itemId]?.axisPositions}
                                axes={state.axes}
                                showInfo={showInfoId === itemId}
                                onInfoToggle={(id) => setShowInfoId(prev => prev === id ? null : id)}
                      />
                    ))}
                  </div>
                </Droppable>
              </SortableContext>
            </CardContent>
          </Card>

          {openCommentId && (
            <div
              data-comment-panel
              ref={commentRef}
              className="fixed z-50 right-4 top-24 w-[min(520px,calc(100vw-2rem))] rounded-xl bg-white text-zinc-900 border border-zinc-300 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-200">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-wider text-zinc-500">Commentaire</div>
                  <div className="font-semibold truncate">
                    {state.items[openCommentId]?.name ?? openCommentId}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!isEditingComment ? (
                    <button
                      type="button"
                      className="px-2 py-1 text-sm rounded-md border border-zinc-300 hover:bg-zinc-100"
                      onClick={() => {
                        setDraftComment(state.items[openCommentId]?.comment ?? "");
                        setIsEditingComment(true);
                      }}
                    >
                      Éditer
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="px-2 py-1 text-sm rounded-md border border-zinc-300 hover:bg-zinc-100"
                        onClick={() => {
                          setIsEditingComment(false);
                          setDraftComment("");
                        }}
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 text-sm rounded-md bg-amber-500 text-black hover:bg-amber-400"
                        onClick={() => {
                          if (!openCommentId) return;
                          const value = draftComment.trim();
                          setState((s) => {
                            const items = { ...s.items };
                            if (items[openCommentId]) {
                              items[openCommentId] = {
                                ...items[openCommentId],
                                comment: value || undefined,
                              };
                            }
                            return { ...s, items };
                          });
                          setIsEditingComment(false);
                          setDraftComment("");
                        }}
                      >
                        Enregistrer
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="px-2 py-1 text-sm rounded-md border border-zinc-300 hover:bg-zinc-100"
                    onClick={() => {
                      if (!openCommentId) return;
                      setState((s) => {
                        const items = { ...s.items };
                        if (items[openCommentId]) {
                          items[openCommentId] = { ...items[openCommentId], comment: undefined };
                        }
                        return { ...s, items };
                      });
                      setIsEditingComment(false);
                      setDraftComment("");
                    }}
                  >
                    Supprimer
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-sm rounded-md border border-zinc-300 hover:bg-zinc-100"
                    onClick={() => {
                      setOpenCommentId(null);
                      setIsEditingComment(false);
                      setDraftComment("");
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="p-3 text-sm leading-relaxed">
                {!isEditingComment ? (
                  <div className="whitespace-pre-wrap">
                    {state.items[openCommentId]?.comment || <span className="text-zinc-500">—</span>}
                  </div>
                ) : (
                  <Textarea
                    value={draftComment}
                    onChange={(e) => setDraftComment(e.target.value)}
                    rows={8}
                    className="w-full"
                    placeholder="Écris ton commentaire ici…"
                  />
                )}
              </div>
            </div>
          )}

          <DragOverlay>
            {activeId ? (
                              <Tile
                                key={activeId}
                                id={activeId}
                                name={state.items[activeId]?.name ?? ""}
                                image={state.items[activeId]?.image}
                                comment={state.items[activeId]?.comment}
                                tileSize={state.tileSize}
                                isCommentOpen={openCommentId === activeId}
                                onCommentToggle={toggleCommentFor}
                                axisPositions={state.items[activeId]?.axisPositions}
                                axes={state.axes}
                                showInfo={showInfoId === activeId}
                                onInfoToggle={(id) => setShowInfoId(prev => prev === id ? null : id)}
                              />
                             ) : null}
                            </DragOverlay>
        </DndContext>

        <Card>
          <CardHeader>
            <CardTitle>Importer noms + images + commentaires</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className={cx("text-sm", T.mutedText)}>
              Une ligne par artiste. Formats acceptés : <code>Nom    URL    Commentaire</code>,{" "}
              <code>Nom | URL | Commentaire</code>, <code>Nom,URL,Commentaire</code>,{" "}
              <code>Nom;URL;Commentaire</code>. L'image et le commentaire sont optionnels.
            </p>
            <Textarea
              className={cx("w-full resize-y", INPUT_DARK)}
              rows={6}
              value={pairsText}
              onChange={(e) => setPairsText(e.target.value)}
              placeholder={`Ex.\nNekfeu\thttps://exemple.com/nekfeu.jpg Un court commentaire\nPNL | https://exemple.com/pnl.webp`}
            />
            <div className="flex gap-2">
              <Button onClick={importPairs}>
                <Upload className="w-4 h-4 mr-2" />
                Ajouter au bac
              </Button>
              <Button variant="outline" className={OUTLINE_DARK} onClick={() => setPairsText("")}>
                <Trash2 className="w-4 h-4 mr-2" />
                Vider la zone
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className={cx("text-xs", T.mutedText)}>
          <p>
            Persistance : l'état est sauvegardé dans votre navigateur et peut être encodé dans l'URL (bouton « Partager le lien »).
            Pour un lien public stable, déployez ce fichier sur Vercel.
          </p>
        </div>
      </div>
    </div>
  );
}
