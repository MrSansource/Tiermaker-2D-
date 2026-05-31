'use client';
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
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
import { Download, Link2, Plus, RefreshCcw, Upload, Scissors, Trash2, MessageSquare, X, Edit, Filter, Palette } from "lucide-react";

type Tier = { label: string; color: string; hidden?: boolean; };

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
  categorySlug: string;
  categoryLabel: string;
  axes: AxisDefinition[];
  activeVerticalAxisId: string;
  activeHorizontalAxisId: string;
  activeColorAxisId?: string | null;
  tileLinksEnabled?: boolean;
  tileLinkTemplate?: string;
  containers: Record<string, string[]>;
  items: Record<string, Item>;
  poolId: string;
  tileSize: number;
  forceDark: boolean;
};

type SeedSummary = {
  id: string;
  categorySlug: string;
  uploadedAt?: string;
  url?: string;
};

type CategorySummary = {
  slug: string;
  label: string;
  seedCount: number;
  updatedAt?: string;
};

const POOL_ID = "__pool__";
const UNCLASSIFIED_INDEX = -1;
const TIER_DRAG_PREFIX = "__tier__";
const DEFAULT_CATEGORY_LABEL = "Rap français";
const DEFAULT_CATEGORY_SLUG = "rap-francais";
const DEFAULT_TILE_LINK_TEMPLATE = "https://www.google.com/search?q={name}";

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

const IMPORT_TIER_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#22c55e", "#06b6d4",
  "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#94a3b8",
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

function categorySlugFromLabel(label: string) {
  return slug(label) || DEFAULT_CATEGORY_SLUG;
}

function labelFromCategorySlug(value: string) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || DEFAULT_CATEGORY_LABEL;
}

function withCategory(state: AppState, label: string): AppState {
  const cleanLabel = label.trim() || DEFAULT_CATEGORY_LABEL;
  return {
    ...state,
    categoryLabel: cleanLabel,
    categorySlug: categorySlugFromLabel(cleanLabel),
  };
}

function normalizeStateCategory(state: AppState): AppState {
  const label = state.categoryLabel || DEFAULT_CATEGORY_LABEL;
  return {
    ...state,
    categoryLabel: label,
    categorySlug: state.categorySlug || categorySlugFromLabel(label),
    activeColorAxisId: state.activeColorAxisId || null,
    tileLinksEnabled: state.tileLinksEnabled || false,
    tileLinkTemplate: state.tileLinkTemplate || DEFAULT_TILE_LINK_TEMPLATE,
  };
}

function normalizeText(s: string) {
  return s.toLowerCase().normalize("NFD").replace(COMBINING_MARKS_RE, "");
}

function mergeTextField(existing?: string, incoming?: string) {
  const clean = (incoming || "").trim();
  return clean || existing;
}

function itemNameKey(name: string) {
  return normalizeText(name).trim();
}

function itemIdForName(name: string, items: Record<string, Item>) {
  const key = itemNameKey(name);
  for (const [id, item] of Object.entries(items)) {
    if (itemNameKey(item.name) === key) return id;
  }
  return null;
}

function mergeAxisPositions(
  existing: Record<string, number | null>,
  incoming: Record<string, number | null>
) {
  const merged = { ...existing };
  for (const [axisId, position] of Object.entries(incoming)) {
    if (merged[axisId] === undefined || merged[axisId] === null) {
      merged[axisId] = position;
    }
  }
  return merged;
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
    const m = line.match(/https?:\/\/[^\s|;,]+/);
    if (m) {
      const url = m[0].replace(/[)\].,;]+$/, "");
      const before = line.slice(0, m.index as number).trim();
      const name = before.split(/[|;,\t]/).join(" ").replace(/\s{2,}/g, " ").trim();
      const after = line.slice((m.index as number) + m[0].length);
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

function tierDragId(axisId: string, tierIndex: number) {
  return `${TIER_DRAG_PREFIX}:${axisId}:${tierIndex}`;
}

function parseTierDragId(id: string) {
  if (!id.startsWith(`${TIER_DRAG_PREFIX}:`)) return null;
  const [, axisId, index] = id.split(":");
  const tierIndex = Number(index);
  if (!axisId || !Number.isInteger(tierIndex)) return null;
  return { axisId, tierIndex };
}

function buildTileLink(template: string, name: string) {
  const encodedName = encodeURIComponent(name);
  const safeTemplate = (template || DEFAULT_TILE_LINK_TEMPLATE).trim();
  if (safeTemplate.includes("{name}")) return safeTemplate.replaceAll("{name}", encodedName);
  return `${safeTemplate}${encodedName}`;
}

function splitImportLine(line: string) {
  if (line.includes("\t")) return line.split("\t").map(cell => cell.trim());
  if (line.includes(";")) return line.split(";").map(cell => cell.trim());
  if (line.includes(",")) return line.split(",").map(cell => cell.trim());
  return [line.trim()];
}

function clipboardRowsFromHtml(html: string) {
  if (!html || typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = Array.from(doc.querySelectorAll("tr"));
  if (!rows.length) return "";
  return rows.map(row =>
    Array.from(row.querySelectorAll("th,td"))
      .map(cell => (cell.textContent || "").replace(/\s+/g, " ").trim())
      .join("\t")
  ).join("\n");
}

function isNameHeader(value: string) {
  const clean = normalizeText(value.trim());
  return clean === "nom" || clean === "name" || clean === "tuile" || clean === "titre";
}

function isImageHeader(value: string) {
  const clean = normalizeText(value.trim());
  return clean === "image" || clean === "url" || clean === "lien" || clean === "image url";
}

function isCommentHeader(value: string) {
  const clean = normalizeText(value.trim());
  return clean === "commentaire" || clean === "comment" || clean === "note" || clean === "notes";
}

function sheetImportColumns(headers: string[]) {
  if (headers.length < 3 || !isNameHeader(headers[0]) || !isImageHeader(headers[1])) return null;
  const commentIndex = headers.findIndex((header, index) => index >= 2 && isCommentHeader(header));
  const axisColumns = headers
    .map((header, index) => ({ header: header.trim(), index }))
    .filter(({ index }) => index >= 2 && index !== commentIndex);
  if (!axisColumns.length) return null;
  return { commentIndex, axisColumns };
}

function isImageUrl(value?: string) {
  return /^https?:\/\/\S+/i.test((value || "").trim());
}

function looksLikeSheetImport(text: string) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  return Boolean(sheetImportColumns(splitImportLine(lines[0])));
}

function parseSheetImport(text: string) {
  const rows = text.split(/\r?\n/)
    .map(line => splitImportLine(line))
    .filter(row => row.some(cell => cell.trim()));
  if (rows.length < 2) return null;

  const headers = rows[0];
  const columns = sheetImportColumns(headers);
  if (!columns) return null;

  const usedAxisIds = new Set<string>();
  const axes: AxisDefinition[] = columns.axisColumns.map(({ header }, index) => {
    const label = header || `Axe ${index + 1}`;
    const baseId = slug(label) || `axis-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedAxisIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedAxisIds.add(id);
    return {
      id,
      label,
      tiers: [],
      tierWidths: [],
      unclassifiedSize: 150,
    };
  });

  const tierIndexes = axes.map(() => new Map<string, number>());
  const items: Record<string, Item> = {};
  const allIds: string[] = [];

  for (const row of rows.slice(1)) {
    const name = (row[0] || "").trim();
    if (!name) continue;

    const base = slug(name) || Math.random().toString(36).slice(2);
    const id = items[base] ? `${base}-${Math.random().toString(36).slice(2, 6)}` : base;
    const axisPositions: Record<string, number | null> = {};

    axes.forEach((axis, axisIndex) => {
      const value = (row[columns.axisColumns[axisIndex].index] || "").trim();
      if (!value) {
        axisPositions[axis.id] = null;
        return;
      }
      if (normalizeText(value) === "x") {
        axisPositions[axis.id] = UNCLASSIFIED_INDEX;
        return;
      }

      const key = normalizeText(value);
      let tierIndex = tierIndexes[axisIndex].get(key);
      if (tierIndex === undefined) {
        tierIndex = axis.tiers.length;
        tierIndexes[axisIndex].set(key, tierIndex);
        axis.tiers.push({
          label: value,
          color: IMPORT_TIER_COLORS[tierIndex % IMPORT_TIER_COLORS.length],
        });
        axis.tierWidths?.push(220);
      }
      axisPositions[axis.id] = tierIndex;
    });

    items[id] = {
      id,
      name,
      image: (row[1] || "").trim() || undefined,
      comment: columns.commentIndex >= 0 ? ((row[columns.commentIndex] || "").trim() || undefined) : undefined,
      axisPositions,
    };
    allIds.push(id);
  }

  const finalAxes = axes.map(axis => ({
    ...axis,
    tiers: axis.tiers.length ? axis.tiers : [{ label: "A classer", color: "#94a3b8" }],
    tierWidths: axis.tierWidths?.length ? axis.tierWidths : [220],
  }));

  while (finalAxes.length < 2) {
    const id = `axis-${finalAxes.length + 1}`;
    finalAxes.push({
      id,
      label: `Axe ${finalAxes.length + 1}`,
      tiers: [{ label: "A classer", color: "#94a3b8" }],
      tierWidths: [220],
      unclassifiedSize: 150,
    });
    for (const item of Object.values(items)) item.axisPositions[id] = null;
  }

  return { axes: finalAxes, items, allIds };
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
  "1) Choisissez ou créez une catégorie, puis cliquez sur 'Publier (nouveau seed)' : un ID et un lien ?category=…&seed=… sont générés.",
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
  id, name, image, comment, tileSize, selected, highlighted, onClick, 
  isCommentOpen, onCommentToggle, axisPositions, axes, showInfo, onInfoToggle, colorFrame,
  colorAxis, onColorCycle, tileLink, onEdit,
}: {
  id: string; name: string; image?: string; comment?: string; tileSize: number;
  selected?: boolean; highlighted?: boolean; onClick?: () => void;
  isCommentOpen?: boolean; onCommentToggle?: (id: string) => void;
  axisPositions?: Record<string, number | null>;
  axes?: AxisDefinition[];
  showInfo?: boolean;
  onInfoToggle?: (id: string) => void;
  colorFrame?: { color: string; label: string } | null;
  colorAxis?: AxisDefinition | null;
  onColorCycle?: (id: string) => void;
  tileLink?: string | null;
  onEdit?: (id: string, updates: { name?: string; image?: string }) => void;
}) {
  const [isEditingTile, setIsEditingTile] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftImage, setDraftImage] = useState(image || "");
  const [imageFailed, setImageFailed] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const iconButtonCls = "absolute right-1 z-20 h-5 w-5 inline-flex items-center justify-center rounded-full bg-black/45 hover:bg-black/65 transition border border-white/25";
  const commitEdit = () => {
    const clean = draftName.trim();
    const cleanImage = draftImage.trim();
    if (clean && (clean !== name || cleanImage !== (image || ""))) {
      onEdit?.(id, { name: clean, image: cleanImage });
    }
    setDraftName(clean || name);
    setDraftImage(cleanImage);
    setIsEditingTile(false);
  };

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: tileSize,
    height: tileSize,
    touchAction: "none",
    ...(colorFrame
      ? {
          borderColor: colorFrame.color,
          boxShadow: `0 0 0 2px ${colorFrame.color}, 0 6px 16px rgba(0,0,0,0.25)`,
        }
      : {}),
  };

  const hasPositions = axisPositions && Object.values(axisPositions).some(v => v !== null && v !== -1);
  const nameContent = tileLink ? (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        window.open(tileLink, "_blank", "noopener,noreferrer");
      }}
      className="relative z-20 max-w-full text-center font-semibold text-white drop-shadow-sm underline-offset-2 hover:underline"
      title={`Ouvrir ${tileLink}`}
    >
      {name}
    </button>
  ) : (
    <span className="relative z-10 font-semibold text-white drop-shadow-sm">{name}</span>
  );

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout
      data-item-id={id}
      onMouseDown={(e) => e.stopPropagation()} // Important : ne pas interférer avec le drag
      onClick={(e) => { 
        e.stopPropagation();
        // AJOUT : vérifier qu'on ne clique pas sur un bouton
        const target = e.target as HTMLElement;
        if (target.closest('button')) return; // Ne pas déclencher onClick si on clique sur un bouton
        onClick?.(); 
      }}
      className={cx(
        "relative overflow-visible select-none inline-flex items-center justify-center rounded-2xl shadow-sm border p-2 text-sm font-medium cursor-grab active:cursor-grabbing",
        "bg-zinc-900 border-zinc-700 text-zinc-100",
        colorFrame ? "border-2" : "",
        selected ? "ring-2 ring-indigo-400" : highlighted ? "ring-2 ring-amber-400" : "",
        showInfo ? "z-50" : "z-0"
      )}
      title={colorFrame ? `Axe couleur : ${colorFrame.label}` : undefined}
      {...attributes}
      {...listeners}
    >
      {isEditingTile && (
        <div
          className="absolute inset-1 z-40 flex flex-col items-stretch justify-center gap-1 rounded-xl bg-black/80 p-1"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            autoFocus
            className="w-full rounded-md border border-white/35 bg-zinc-950/90 px-2 py-1 text-center text-xs font-semibold text-white outline-none"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") {
                setDraftName(name);
                setDraftImage(image || "");
                setIsEditingTile(false);
              }
            }}
          />
          <input
            className="w-full rounded-md border border-white/25 bg-zinc-950/90 px-2 py-1 text-[10px] text-white outline-none placeholder:text-zinc-500"
            value={draftImage}
            placeholder="URL image"
            onChange={(e) => setDraftImage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") {
                setDraftName(name);
                setDraftImage(image || "");
                setIsEditingTile(false);
              }
            }}
          />
          <div className="flex justify-center gap-1">
            <button type="button" className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-900" onClick={commitEdit}>
              OK
            </button>
            <button
              type="button"
              className="rounded border border-white/30 px-2 py-0.5 text-[10px] text-white"
              onClick={() => {
                setDraftName(name);
                setDraftImage(image || "");
                setIsEditingTile(false);
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {image && !imageFailed ? (
        <>
          <img
            src={image}
            alt={name}
            referrerPolicy="no-referrer"
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover rounded-2xl"
            onLoad={() => setImageFailed(false)}
            onError={() => setImageFailed(true)}
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1 text-[11px] text-center rounded-b-2xl">
            {nameContent}
          </div>
        </>
      ) : (
        imageFailed && image ? (
          <div className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-center">
            <span className="text-[10px] font-semibold leading-tight break-words">{name}</span>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                window.open(image, "_blank", "noopener,noreferrer");
              }}
              className="rounded border border-zinc-600 px-1 py-0.5 text-[9px] text-zinc-300 hover:bg-zinc-800"
              title={image}
            >
              ouvrir image
            </button>
          </div>
        ) : (
          tileLink ? (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                window.open(tileLink, "_blank", "noopener,noreferrer");
              }}
              className="relative text-center leading-tight px-1 break-words z-20 hover:underline"
              title={`Ouvrir ${tileLink}`}
            >
              {name}
            </button>
          ) : (
            <span className="relative text-center leading-tight px-1 break-words z-10">{name}</span>
          )
        )
      )}

      {hasPositions && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onInfoToggle?.(id); }}
          className={cx(iconButtonCls, "top-7")}
          title="Informations de classement"
        >
          <span className="text-[11px] font-bold text-white">i</span>
        </button>
      )}

            {showInfo && hasPositions && axes && (
              <div
                data-info-panel="1"
                className="absolute left-full top-0 ml-2 bg-white text-zinc-900 rounded-lg shadow-xl p-3 text-sm z-50 min-w-[200px] border border-zinc-300"
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
              </div>
            )}

      {colorAxis && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onColorCycle?.(id); }}
          className={cx(iconButtonCls, "bottom-1")}
          style={colorFrame ? { backgroundColor: colorFrame.color, color: textColorForBg(colorFrame.color) } : undefined}
          title={`Changer ${colorAxis.label}`}
        >
          <Palette className="h-3 w-3" />
        </button>
      )}

      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setDraftName(name);
          setDraftImage(image || "");
          setIsEditingTile(true);
        }}
        className={cx(iconButtonCls, "bottom-7")}
        title="Modifier la tuile"
      >
        <Edit className="h-3 w-3 text-zinc-100" />
      </button>

      {comment && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onCommentToggle?.(id); }}
          className={cx(iconButtonCls, "top-1 border-transparent")}
          title={isCommentOpen ? "Masquer le commentaire" : "Afficher le commentaire"}
        >
          {isCommentOpen ? <X className="h-3 w-3 text-zinc-100" /> : <MessageSquare className="h-3 w-3 text-zinc-100" />}
        </button>
      )}
    </motion.div>
  );
}

function SortableTierHeader({
  id,
  label,
  color,
  className,
  onRename,
}: {
  id: string;
  label: string;
  color: string;
  className?: string;
  onRename?: (label: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(label);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    backgroundColor: color,
    color: textColorForBg(color),
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };
  const commitRename = () => {
    const clean = draftLabel.trim();
    if (clean && clean !== label) onRename?.(clean);
    setDraftLabel(clean || label);
    setIsEditing(false);
  };
  const dragProps = isEditing ? {} : { ...attributes, ...listeners };

  return (
    <div
      ref={setNodeRef}
      className={cx(
        className,
        "flex items-center justify-center text-center",
        isEditing ? "cursor-text" : "cursor-grab active:cursor-grabbing select-none"
      )}
      style={style}
      title={isEditing ? "Entrer pour valider" : "Double-cliquer pour renommer, glisser pour reordonner"}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraftLabel(label);
        setIsEditing(true);
      }}
      {...dragProps}
    >
      {isEditing ? (
        <input
          autoFocus
          className="w-full rounded-md border border-white/40 bg-black/35 px-2 py-1 text-center text-sm font-semibold outline-none"
          value={draftLabel}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraftLabel(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setDraftLabel(label);
              setIsEditing(false);
            }
          }}
        />
      ) : (
        <span className="w-full break-words">{label}</span>
      )}
    </div>
  );
}

function Droppable({ id, children, onClick }: { id: string; children: React.ReactNode; onClick?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      data-droppable-id={id}
      onClick={(e) => {
        // AJOUT : ne déclencher que si on clique sur le fond, pas sur une tuile
        const target = e.target as HTMLElement;
        if (target.closest('[data-item-id]')) return;
        onClick?.();
      }}
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
    categorySlug: DEFAULT_CATEGORY_SLUG,
    categoryLabel: DEFAULT_CATEGORY_LABEL,
    axes: [talentAxis, styleAxis],
    activeVerticalAxisId: "talent",
    activeHorizontalAxisId: "style",
    activeColorAxisId: null,
    tileLinksEnabled: false,
    tileLinkTemplate: DEFAULT_TILE_LINK_TEMPLATE,
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
  if (obj.axes && Array.isArray(obj.axes)) return normalizeStateCategory(obj as AppState);

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
    categorySlug: obj.categorySlug || DEFAULT_CATEGORY_SLUG,
    categoryLabel: obj.categoryLabel || DEFAULT_CATEGORY_LABEL,
    axes: [talentAxis, styleAxis],
    activeVerticalAxisId: "talent",
    activeHorizontalAxisId: "style",
    activeColorAxisId: obj.activeColorAxisId || null,
    tileLinksEnabled: Boolean(obj.tileLinksEnabled),
    tileLinkTemplate: obj.tileLinkTemplate || DEFAULT_TILE_LINK_TEMPLATE,
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
  const [loadingWikiImages, setLoadingWikiImages] = useState(false);
  const [loadingGoogleImages, setLoadingGoogleImages] = useState(false);
  const [loadingSerpImages, setLoadingSerpImages] = useState(false);
  const [loadingPinterestImages, setLoadingPinterestImages] = useState(false);
  const [loadingBrightDataImages, setLoadingBrightDataImages] = useState(false);
  const [isPoolPinned, setIsPoolPinned] = useState(false);
  const [poolSplitSide, setPoolSplitSide] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [seedInput, setSeedInput] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [loadingSeed, setLoadingSeed] = useState(false);
  const [lastSeedId, setLastSeedId] = useState<string | null>(null);
  const [categoryInput, setCategoryInput] = useState(initialState.categoryLabel);
  const [categorySeeds, setCategorySeeds] = useState<SeedSummary[]>([]);
  const [loadingCategorySeeds, setLoadingCategorySeeds] = useState(false);
  const [showCategoryBrowser, setShowCategoryBrowser] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [showHelp, setShowHelp] = useState(true);
  const [showAxisManager, setShowAxisManager] = useState(false);
  const [openCommentId, setOpenCommentId] = useState<string | null>(null);
  const [isEditingComment, setIsEditingComment] = useState(false);
  const [draftComment, setDraftComment] = useState("");
  const [poolAlpha, setPoolAlpha] = useState<AlphaKey | null>(null);
  const [editingAxisId, setEditingAxisId] = useState<string | null>(null);
  const [showPartialOnly, setShowPartialOnly] = useState(false);
  const [showInfoId, setShowInfoId] = useState<string | null>(null);
  const [commentPanelPosition, setCommentPanelPosition] = useState({ x: 0, y: 0 });
  const commentRef = useRef<HTMLDivElement | null>(null);
  const appRootRef = useRef<HTMLDivElement | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const vAxis = state.axes.find(a => a.id === state.activeVerticalAxisId) || state.axes[0];
  const hAxis = state.axes.find(a => a.id === state.activeHorizontalAxisId) || state.axes[1] || state.axes[0];
  const colorAxis = state.activeColorAxisId
    ? state.axes.find(a => a.id === state.activeColorAxisId)
    : null;
  const visibleVTiers = vAxis.tiers
    .map((tier, index) => ({ tier, index }))
    .filter(({ tier }) => !tier.hidden);
  const visibleHTiers = hAxis.tiers
    .map((tier, index) => ({ tier, index }))
    .filter(({ tier }) => !tier.hidden);

  const matchedIds = useMemo(() => {
    const q = normalizeText(search);
    if (!q) return new Set<string>();
    const s = new Set<string>();
    for (const [id, it] of Object.entries(state.items)) {
      if (normalizeText(it.name).includes(q)) s.add(id);
    }
    return s;
  }, [state.items, search]);

  const getColorFrame = (itemId: string) => {
    if (!colorAxis) return null;
    const pos = state.items[itemId]?.axisPositions?.[colorAxis.id];
    if (pos === null || pos === undefined || pos < 0) return null;
    const tier = colorAxis.tiers[pos];
    if (!tier) return null;
    return { color: tier.color, label: `${colorAxis.label} : ${tier.label}` };
  };

  const getTileLink = (itemId: string) => {
    if (!state.tileLinksEnabled) return null;
    const item = state.items[itemId];
    if (!item?.name) return null;
    return buildTileLink(state.tileLinkTemplate || DEFAULT_TILE_LINK_TEMPLATE, item.name);
  };

  function cycleColorAxisPosition(itemId: string) {
    if (!colorAxis || !colorAxis.tiers.length) return;
    setState(prev => {
      const axis = prev.axes.find(a => a.id === colorAxis.id);
      const item = prev.items[itemId];
      if (!axis || !item) return prev;

      const current = item.axisPositions[axis.id];
      const next = current === null || current === undefined || current < 0
        ? 0
        : current + 1 >= axis.tiers.length
          ? 0
          : current + 1;

      return {
        ...prev,
        items: {
          ...prev.items,
          [itemId]: {
            ...item,
            axisPositions: {
              ...item.axisPositions,
              [axis.id]: next,
            },
          },
        },
      };
    });
  }

  useEffect(() => {
    try {
      localStorage.setItem("tierlist2d-state", JSON.stringify(state));
    } catch {}
  }, [state]);

  useEffect(() => {
    function handleGlobalClick(ev: MouseEvent) {
      const t = ev.target as HTMLElement | null;
      if (!t) return;
      const clickedUseful = t.closest("[data-item-id]") ||
        t.closest("[data-droppable-id]") || t.closest("[data-cell-id]") ||
        t.closest("[data-pool-root]") || t.closest("[data-comment-panel]") ||
        t.closest("button,[role='button'],input,textarea,select,a,[contenteditable='true']");
      if (clickedUseful) return;
      setOpenCommentId(null);
      setIsEditingComment(false);
      setSelectedId(null);
      setShowInfoId(null);
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
      const sid = localStorage.getItem(`tier2d-last-seed-id-${state.categorySlug}`);
      if (sid) setLastSeedId(sid);
      else setLastSeedId(null);
    } catch {}
  }, [state.categorySlug]);

  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      const category = url.searchParams.get('category');
      const seed = url.searchParams.get('seed');
      if (category && !seed) {
        const label = url.searchParams.get('categoryName') || labelFromCategorySlug(category);
        setState(prev => ({ ...prev, categorySlug: categorySlugFromLabel(category), categoryLabel: label }));
        setCategoryInput(label);
      }
      if (seed) loadSeed(seed, category || undefined);
    } catch {}
  }, []);

  useEffect(() => {
    setCategoryInput(state.categoryLabel);
    refreshCategorySeeds(state.categorySlug);
    refreshCategories();
  }, [state.categorySlug, state.categoryLabel]);

  useEffect(() => {
  if (!openCommentId) return;
  const tile = document.querySelector(`[data-item-id="${openCommentId}"]`);
  if (tile) {
    const rect = tile.getBoundingClientRect();
    setCommentPanelPosition({ x: rect.left, y: rect.top });
  }
}, [openCommentId]);

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

  const getContainerByItem = (
    itemId: string,
    containers: Record<string, string[]> = state.containers
  ) => {
    for (const [cid, arr] of Object.entries(containers)) if (arr.includes(itemId)) return cid;
    return null;
  };

  const getContainerFromOverId = (overId: string, containers: Record<string, string[]>) => {
    if (overId === POOL_ID || /^r-?\d+-c-?\d+$/.test(overId)) return overId;
    return getContainerByItem(overId, containers);
  };

  function updateItemAxisPositionsForContainer(prev: AppState, item: Item, containerId: string) {
    const axisPositions = { ...item.axisPositions };

    if (containerId === prev.poolId) {
      axisPositions[prev.activeVerticalAxisId] = null;
      axisPositions[prev.activeHorizontalAxisId] = null;
      return axisPositions;
    }

    const match = containerId.match(/^r(-?\d+)-c(-?\d+)$/);
    if (!match) return axisPositions;

    const r = parseInt(match[1], 10);
    const c = parseInt(match[2], 10);
    const wasFullyUnclassified = Object.values(axisPositions).every(v => v === null);

    axisPositions[prev.activeVerticalAxisId] = r;
    axisPositions[prev.activeHorizontalAxisId] = c;

    if (wasFullyUnclassified) {
      for (const axis of prev.axes) {
        if (axis.id !== prev.activeVerticalAxisId && axis.id !== prev.activeHorizontalAxisId) {
          axisPositions[axis.id] = UNCLASSIFIED_INDEX;
        }
      }
    }

    return axisPositions;
  }

  function moveItemInState(prev: AppState, itemId: string, containerId: string, beforeId?: string | null): AppState {
    const from = getContainerByItem(itemId, prev.containers);
    if (!from || !prev.items[itemId]) return prev;

    const containers = { ...prev.containers };
    const sourceItems = [...(containers[from] || [])].filter(id => id !== itemId);
    const destBase = from === containerId
      ? sourceItems
      : [...(containers[containerId] || [])].filter(id => id !== itemId);

    const insertAt = beforeId && beforeId !== itemId ? destBase.indexOf(beforeId) : -1;
    const destItems = [...destBase];
    if (insertAt >= 0) destItems.splice(insertAt, 0, itemId);
    else destItems.push(itemId);

    containers[from] = sourceItems;
    containers[containerId] = containerId === prev.poolId
      ? sortIdsAlpha(destItems, prev.items)
      : destItems;

    const items = { ...prev.items };
    items[itemId] = {
      ...items[itemId],
      axisPositions: updateItemAxisPositionsForContainer(prev, items[itemId], containerId),
    };

    return { ...prev, containers, items };
  }

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
    
    // Cas 1: Jamais classé sur aucun axe (null × null)
    if (vPos === null && hPos === null) {
      containers[POOL_ID].push(id);
      continue;
    }
    
    // Cas 2: À classer sur les deux axes affichés (-1 × -1)
    if (vPos === -1 && hPos === -1) {
      containers[POOL_ID].push(id);
      continue;
    }
    
    // Cas 3a: Classé horizontal, à classer vertical (null ou -1 sur v, >= 0 sur h)
    if ((vPos === null || vPos === -1) && hPos !== null && hPos >= 0 && hPos < hTiersCount) {
      const cid = `r-1-c${hPos}`;
      containers[cid] = containers[cid] || [];
      containers[cid].push(id);
      continue;
    }
    
    // Cas 3b: Classé vertical, à classer horizontal (>= 0 sur v, null ou -1 sur h)
    if (vPos !== null && vPos >= 0 && vPos < vTiersCount && (hPos === null || hPos === -1)) {
      const cid = `r${vPos}-c-1`;
      containers[cid] = containers[cid] || [];
      containers[cid].push(id);
      continue;
    }
    
    // Cas 4: Position valide sur les deux axes
    if (vPos !== null && hPos !== null && vPos >= 0 && hPos >= 0 && 
        vPos < vTiersCount && hPos < hTiersCount) {
      const cid = `r${vPos}-c${hPos}`;
      containers[cid] = containers[cid] || [];
      containers[cid].push(id);
      continue;
    }
    
    // Cas 5: Position invalide ou hors limites → au pool
    containers[POOL_ID].push(id);
  }
  
  containers[POOL_ID] = sortIdsAlpha(containers[POOL_ID], items);
  return containers;
}
  
  function moveToContainer(itemId: string, containerId: string) {
    setState((prev) => moveItemInState(prev, itemId, containerId));
  }
  function toggleCommentFor(id: string) {
    if (openCommentId === id) {
      setOpenCommentId(null);
      setIsEditingComment(false);
      return;
    }
    setShowInfoId(null);
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

  function updateItemDetails(id: string, updates: { name?: string; image?: string }) {
    setState((prev) => {
      const item = prev.items[id];
      if (!item) return prev;
      const name = updates.name?.trim() || item.name;
      const image = updates.image?.trim() || undefined;
      return {
        ...prev,
        items: {
          ...prev.items,
          [id]: {
            ...item,
            name,
            image,
          },
        },
      };
    });
    setSelectedId(null);
  }

  function deletePoolItems() {
    const ids = state.containers[state.poolId] || [];
    if (!ids.length) return;
    if (!confirm(`Supprimer les ${ids.length} tuiles du bac ?`)) return;

    setState((prev) => {
      const poolIds = new Set(prev.containers[prev.poolId] || []);
      const items = { ...prev.items };
      for (const id of poolIds) delete items[id];

      return {
        ...prev,
        items,
        containers: {
          ...prev.containers,
          [prev.poolId]: [],
        },
      };
    });
    if (selectedId && ids.includes(selectedId)) setSelectedId(null);
    if (openCommentId && ids.includes(openCommentId)) {
      setOpenCommentId(null);
      setIsEditingComment(false);
    }
  }

  function moveTierInAxis(axisId: string, fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    setState((prev) => {
      const axis = prev.axes.find(a => a.id === axisId);
      if (!axis || !axis.tiers[fromIndex] || !axis.tiers[toIndex]) return prev;

      const oldOrder = axis.tiers.map((_, index) => index);
      const newOrder = arrayMove(oldOrder, fromIndex, toIndex);
      const oldToNew = new Map<number, number>();
      newOrder.forEach((oldIndex, newIndex) => oldToNew.set(oldIndex, newIndex));

      const axes = prev.axes.map(a => {
        if (a.id !== axisId) return a;
        return {
          ...a,
          tiers: arrayMove(a.tiers, fromIndex, toIndex),
          tierWidths: a.tierWidths ? arrayMove(a.tierWidths, fromIndex, toIndex) : a.tierWidths,
        };
      });

      const items: Record<string, Item> = {};
      for (const [id, item] of Object.entries(prev.items)) {
        const pos = item.axisPositions[axisId];
        items[id] = pos === null || pos < 0 || !oldToNew.has(pos)
          ? item
          : {
              ...item,
              axisPositions: {
                ...item.axisPositions,
                [axisId]: oldToNew.get(pos)!,
              },
            };
      }

      let containers = prev.containers;
      if (axisId === prev.activeVerticalAxisId || axisId === prev.activeHorizontalAxisId) {
        const nextVAxis = axes.find(a => a.id === prev.activeVerticalAxisId)!;
        const nextHAxis = axes.find(a => a.id === prev.activeHorizontalAxisId)!;
        containers = rebuildContainersForAxes(
          items,
          prev.activeVerticalAxisId,
          prev.activeHorizontalAxisId,
          nextVAxis.tiers.length,
          nextHAxis.tiers.length
        );
      }

      return { ...prev, axes, items, containers };
    });
  }

  function handleDragStart(event: any) {
    setActiveId(event.active?.id ?? null);
  }

  function handleDragOver(event: any) {
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as string;
    if (parseTierDragId(activeId)) return;
    const overId = over.id as string;
    setState((prev) => {
      const sourceContainer = getContainerByItem(activeId, prev.containers);
      const destContainer = getContainerFromOverId(overId, prev.containers);
      if (!sourceContainer || !destContainer || sourceContainer === destContainer) return prev;
      const beforeId = overId === destContainer || overId === prev.poolId ? null : overId;
      return moveItemInState(prev, activeId, destContainer, beforeId);
    });
  }

  function handleDragEnd(event: any) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;
    const activeTier = parseTierDragId(activeId);
    const overTier = parseTierDragId(overId);
    if (activeTier) {
      if (overTier && activeTier.axisId === overTier.axisId) {
        moveTierInAxis(activeTier.axisId, activeTier.tierIndex, overTier.tierIndex);
      }
      return;
    }
    setState((prev) => {
      const sourceContainer = getContainerByItem(activeId, prev.containers);
      const destContainer = getContainerFromOverId(overId, prev.containers);
      if (!sourceContainer || !destContainer) return prev;

      if (sourceContainer !== destContainer) {
        const beforeId = overId === destContainer || overId === prev.poolId ? null : overId;
        return moveItemInState(prev, activeId, destContainer, beforeId);
      }

        if (sourceContainer === prev.poolId) {
          const sorted = sortIdsAlpha([...prev.containers[sourceContainer]], prev.items);
          return { ...prev, containers: { ...prev.containers, [sourceContainer]: sorted } };
        }
        const items = [...prev.containers[sourceContainer]];
        const oldIndex = items.indexOf(activeId);
        let newIndex = items.indexOf(overId);
        if (newIndex === -1) newIndex = oldIndex;
        if (oldIndex === -1 || oldIndex === newIndex) return prev;
        return { ...prev, containers: { ...prev.containers, [sourceContainer]: arrayMove(items, oldIndex, newIndex) } };
    });
  }
  function resetAll() {
    setState(withCategory(stateFromNames([]), state.categoryLabel));
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

  async function refreshCategorySeeds(categorySlug = state.categorySlug) {
    try {
      setLoadingCategorySeeds(true);
      const res = await fetch(`/api/seed?category=${encodeURIComponent(categorySlug)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCategorySeeds(Array.isArray(data.seeds) ? data.seeds : []);
    } catch {
      setCategorySeeds([]);
    } finally {
      setLoadingCategorySeeds(false);
    }
  }

  async function refreshCategories() {
    try {
      setLoadingCategories(true);
      const res = await fetch("/api/seed?categories=1");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCategories(Array.isArray(data.categories) ? data.categories : []);
    } catch {
      setCategories([]);
    } finally {
      setLoadingCategories(false);
    }
  }

  function navigateToCategory(category: CategorySummary) {
    const next = withCategory(stateFromNames([]), category.label);
    const normalized = { ...next, categorySlug: category.slug };
    setState(normalized);
    setCategoryInput(category.label);
    setSeedInput("");
    setSelectedId(null);
    setOpenCommentId(null);
    setShowInfoId(null);
    setLastSeedId(null);
    try {
      const url = `${location.pathname}?category=${encodeURIComponent(category.slug)}&categoryName=${encodeURIComponent(category.label)}`;
      history.replaceState(null, "", url);
    } catch {}
  }

  function goToCategoryByName() {
    const wanted = categorySlugFromLabel(categorySearch);
    const found = categories.find(category => category.slug === wanted);
    if (!found) {
      alert("Aucune categorie existante ne correspond a ce nom.");
      return;
    }
    navigateToCategory(found);
  }

  function applyCategory(label: string) {
    const cleanLabel = label.trim() || DEFAULT_CATEGORY_LABEL;
    setState(prev => withCategory(prev, cleanLabel));
    setCategoryInput(cleanLabel);
    setLastSeedId(null);
  }

  function createCategory() {
    const cleanLabel = categoryInput.trim();
    if (!cleanLabel) return;
    setState(withCategory(stateFromNames([]), cleanLabel));
    setSelectedId(null);
    setOpenCommentId(null);
    setShowInfoId(null);
    setLastSeedId(null);
  }

  function shareCategoryURL() {
    const url = `${location.origin}${location.pathname}?category=${encodeURIComponent(state.categorySlug)}&categoryName=${encodeURIComponent(state.categoryLabel)}`;
    navigator.clipboard?.writeText(url);
    alert(`Lien de catégorie copié : ${url}`);
  }

  function seedApiUrl(seedId: string, categorySlug = state.categorySlug) {
    return `/api/seed/${encodeURIComponent(seedId)}?category=${encodeURIComponent(categorySlug)}`;
  }

  function parseSeedInput(input: string, fallbackCategory = state.categorySlug) {
    const raw = input.trim();
    if (!raw) return { seedId: "", categorySlug: fallbackCategory };
    try {
      const url = new URL(raw);
      const seed = url.searchParams.get("seed") || raw.split("/").filter(Boolean).pop() || "";
      const category = url.searchParams.get("category") || fallbackCategory;
      return { seedId: seed, categorySlug: categorySlugFromLabel(category) };
    } catch {
      return { seedId: raw, categorySlug: fallbackCategory };
    }
  }

  function shareURL() {
    const enc = encodeState(state);
    if (!enc) return;
    const url = `${location.origin}${location.pathname}?category=${encodeURIComponent(state.categorySlug)}#${enc}`;
    navigator.clipboard?.writeText(url);
    alert("Lien copié dans le presse-papiers");
  }

  async function publishSeed(explicitId?: string) {
    try {
      setPublishing(true);
      const encoded = encodeState(state);
      const payload: any = {
        data: encoded,
        categorySlug: state.categorySlug,
        categoryLabel: state.categoryLabel,
      };
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
        localStorage.setItem(`tier2d-last-seed-id-${state.categorySlug}`, id);
      } catch {}
      await refreshCategorySeeds(state.categorySlug);
      const share = `${location.origin}${location.pathname}?category=${encodeURIComponent(state.categorySlug)}&seed=${encodeURIComponent(id)}`;
      await navigator.clipboard?.writeText(share);
      alert(`Seed publié !\nID: ${id}\nLien copié : ${share}`);
    } catch (e: any) {
      alert(`Échec publication du seed. ${e?.message || ''}\nAs-tu bien configuré Vercel Blob et la variable BLOB_READ_WRITE_TOKEN ?`);
    } finally {
      setPublishing(false);
    }
  }

  async function loadSeed(input: string, explicitCategorySlug?: string) {
    try {
      setLoadingSeed(true);
      const parsed = parseSeedInput(input, explicitCategorySlug || state.categorySlug);
      if (!parsed.seedId) return;
      const res = await fetch(seedApiUrl(parsed.seedId, parsed.categorySlug));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const dec = decodeState(j.data);
      const mig = migrateOldState(dec);
      if (mig) {
        setState(mig);
        setCategoryInput(mig.categoryLabel);
        if (j.id) {
          setLastSeedId(j.id);
          try {
            localStorage.setItem(`tier2d-last-seed-id-${mig.categorySlug}`, j.id);
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

  async function findWikipediaImage(name: string) {
    const res = await fetch(`/api/wiki-image?q=${encodeURIComponent(name)}`);
    if (!res.ok) return "";
    const data = await res.json();
    return typeof data?.imageUrl === "string" ? data.imageUrl : "";
  }

  async function findGoogleImage(name: string) {
    const res = await fetch(`/api/google-image?q=${encodeURIComponent(name)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Recherche Google Images impossible");
    return typeof data?.imageUrl === "string" ? data.imageUrl : "";
  }

  async function findSerpImage(name: string) {
    const res = await fetch(`/api/serpapi-image?q=${encodeURIComponent(name)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Recherche SerpAPI impossible");
    return typeof data?.imageUrl === "string" ? data.imageUrl : "";
  }

  async function findPinterestImage(name: string) {
    const res = await fetch(`/api/serpapi-image?q=${encodeURIComponent(`${name} site:pinterest.com`)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Recherche Pinterest impossible");
    return typeof data?.imageUrl === "string" ? data.imageUrl : "";
  }

  async function findBrightDataImage(name: string) {
    const res = await fetch(`/api/brightdata-image?q=${encodeURIComponent(name)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Recherche Bright Data impossible");
    return typeof data?.imageUrl === "string" ? data.imageUrl : "";
  }

  async function prefillMissingImages(
    providerLabel: string,
    findImage: (name: string) => Promise<string>,
    setLoading: (loading: boolean) => void
  ) {
    const lines = pairsText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) return;

    setLoading(true);
    try {
      const rows = lines.map(line => splitImportLine(line));
      const first = rows[0] || [];
      const hasHeader = first.length > 0 && isNameHeader(first[0]);
      const keepHeader = hasHeader && Boolean(sheetImportColumns(first));
      const startIndex = hasHeader ? 1 : 0;
      const cache = new Map<string, string>();
      const targets = rows
        .map((row, index) => ({ row, index, name: (row[0] || "").trim() }))
        .filter(({ row, index, name }) => index >= startIndex && name && !isImageUrl(row[1]));

      let found = 0;
      let done = 0;
      const workers = Array.from({ length: Math.min(4, targets.length) }, async () => {
        while (targets.length) {
          const target = targets.shift();
          if (!target) return;
          const cacheKey = normalizeText(target.name);
          let imageUrl = cache.get(cacheKey) || "";
          if (!cache.has(cacheKey)) {
            const fetchedImageUrl = await findImage(target.name) || "";
            cache.set(cacheKey, fetchedImageUrl);
            imageUrl = fetchedImageUrl;
          }
          done += 1;
          if (!imageUrl) continue;

          while (target.row.length < 2) target.row.push("");
          target.row[1] = imageUrl;
          found += 1;
        }
      });

      await Promise.all(workers);
      const outputRows = keepHeader ? rows : rows.slice(startIndex);
      setPairsText(outputRows.map(row => row.join("\t")).join("\n"));
      alert(`${providerLabel} : ${found} image${found > 1 ? "s" : ""} trouvée${found > 1 ? "s" : ""} sur ${done} ligne${done > 1 ? "s" : ""}.`);
    } catch (e: any) {
      alert(`Échec du pré-remplissage ${providerLabel}. ${e?.message || ""}`);
    } finally {
      setLoading(false);
    }
  }

  function prefillWikipediaImages() {
    return prefillMissingImages("Wikipedia", findWikipediaImage, setLoadingWikiImages);
  }

  function prefillGoogleImages() {
    return prefillMissingImages("Google Images", findGoogleImage, setLoadingGoogleImages);
  }

  function prefillSerpImages() {
    return prefillMissingImages("SerpAPI", findSerpImage, setLoadingSerpImages);
  }

  function prefillPinterestImages() {
    return prefillMissingImages("Pinterest", findPinterestImage, setLoadingPinterestImages);
  }

  function prefillBrightDataImages() {
    return prefillMissingImages("Bright Data", findBrightDataImage, setLoadingBrightDataImages);
  }

  function importPairs() {
    if (looksLikeSheetImport(pairsText)) {
      const sheet = parseSheetImport(pairsText);
      if (!sheet || !sheet.allIds.length) return;

      const activeVerticalAxisId = sheet.axes[0].id;
      const activeHorizontalAxisId = sheet.axes[1].id;
      const currentByName = new Map(
        Object.entries(state.items).map(([id, item]) => [itemNameKey(item.name), { id, item }])
      );
      const importedItems: Record<string, Item> = {};
      const idMap: Record<string, string> = {};

      for (const importedId of sheet.allIds) {
        const incoming = sheet.items[importedId];
        const existing = currentByName.get(itemNameKey(incoming.name));
        const finalId = existing?.id || importedId;
        idMap[importedId] = finalId;
        importedItems[finalId] = existing
          ? {
              ...existing.item,
              name: existing.item.name || incoming.name,
              image: mergeTextField(existing.item.image, incoming.image),
              comment: mergeTextField(existing.item.comment, incoming.comment),
              axisPositions: mergeAxisPositions(existing.item.axisPositions, incoming.axisPositions),
            }
          : { ...incoming, id: finalId };
      }

      const importedIdSet = new Set(Object.values(idMap));
      const items = {
        ...Object.fromEntries(Object.entries(state.items).filter(([id]) => !importedIdSet.has(id))),
        ...importedItems,
      };
      const containers = rebuildContainersForAxes(
        items,
        activeVerticalAxisId,
        activeHorizontalAxisId,
        sheet.axes[0].tiers.length,
        sheet.axes[1].tiers.length
      );
      containers[POOL_ID] = sortIdsAlpha(containers[POOL_ID] || [], items);

      setPairsText("");
      setState((s) => ({
        ...s,
        axes: sheet.axes,
        activeVerticalAxisId,
        activeHorizontalAxisId,
        activeColorAxisId: sheet.axes[2]?.id || null,
        items,
        containers,
      }));
      return;
    }

    const entries = parsePairs(pairsText);
    if (!entries.length) return;
    const items = { ...state.items };
    const pool = [...(state.containers[state.poolId] || [])];
    for (const { name, image, comment } of entries) {
      const existingId = itemIdForName(name, items);
      if (existingId && items[existingId]) {
        items[existingId] = {
          ...items[existingId],
          image: mergeTextField(items[existingId].image, image),
          comment: mergeTextField(items[existingId].comment, comment),
        };
        continue;
      }

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
    if (axisId === state.activeVerticalAxisId || axisId === state.activeHorizontalAxisId || axisId === state.activeColorAxisId) {
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
      const vAxis = prev.axes.find(a => a.id === newId)!;
      const hAxis = prev.axes.find(a => a.id === prev.activeHorizontalAxisId)!;
      const containers = rebuildContainersForAxes(
        prev.items,
        newId,
        prev.activeHorizontalAxisId,
        vAxis.tiers.length,
        hAxis.tiers.length
      );
      return {
        ...prev,
        activeVerticalAxisId: newId,
        activeColorAxisId: prev.activeColorAxisId === newId ? null : prev.activeColorAxisId,
        containers,
      };
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
      return {
        ...prev,
        activeHorizontalAxisId: newId,
        activeColorAxisId: prev.activeColorAxisId === newId ? null : prev.activeColorAxisId,
        containers,
      };
    });
  }

  function switchColorAxis(newId: string) {
    const axisId = newId || null;
    if (axisId && (axisId === state.activeVerticalAxisId || axisId === state.activeHorizontalAxisId)) {
      alert("L'axe couleur doit etre different des axes vertical et horizontal");
      return;
    }
    setState(prev => ({ ...prev, activeColorAxisId: axisId }));
  }

  const T = DARK;

  const vUnclassifiedSize = vAxis.unclassifiedSize || 150;
  const hUnclassifiedSize = hAxis.unclassifiedSize || 150;

  const colsPx = visibleHTiers
    .map(({ index }) => `${(hAxis.tierWidths || [])[index] || 220}px`)
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

  const alphaFilteredPoolIds = showAlphaNav && poolAlpha
    ? filteredPoolIds.filter((id) => bucketForName(state.items[id]?.name || id) === poolAlpha)
    : filteredPoolIds;
  
  const partialCount = poolIds.filter(id => {
    const positions = state.items[id]?.axisPositions || {};
    return Object.values(positions).some(v => v === UNCLASSIFIED_INDEX);
  }).length;
  const importPreviewRows = pairsText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const importPreviewHeaders = importPreviewRows.length ? splitImportLine(importPreviewRows[0]) : [];
  const importPreviewColumns = sheetImportColumns(importPreviewHeaders);

  const poolCard = (
    <Card className={cx(isPoolPinned && "h-full min-h-0 flex flex-col")}>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>Bac (non classés)</CardTitle>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={isPoolPinned}
              onChange={(e) => setIsPoolPinned(e.target.checked)}
            />
            Figer le bac
          </label>
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={poolSplitSide}
              disabled={!isPoolPinned}
              onChange={(e) => setPoolSplitSide(e.target.checked)}
            />
            Gauche / droite
          </label>
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
                  {k === "Autres" ? "Autres" : `${k[0]}-${k[1]}`}
                </button>
              ))}
            </>
          )}
          <Button
            variant="outline"
            className={OUTLINE_DARK}
            size="sm"
            disabled={!poolIds.length}
            onClick={deletePoolItems}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Vider le bac
          </Button>
        </div>
      </CardHeader>
      <CardContent className={cx(T.cardBg, isPoolPinned && "min-h-0 flex-1 overflow-auto")}>
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
                          colorFrame={getColorFrame(itemId)}
                          colorAxis={colorAxis}
                          onColorCycle={cycleColorAxisPosition}
                          tileLink={getTileLink(itemId)}
                          onEdit={updateItemDetails}
                          showInfo={showInfoId === itemId}
                          onInfoToggle={(id) => {
                            setOpenCommentId(null);
                            setIsEditingComment(false);
                            setShowInfoId(prev => prev === id ? null : id);
                          }}
                            />
              ))}
            </div>
          </Droppable>
        </SortableContext>
      </CardContent>
    </Card>
  );

  const filteredCategories = categorySearch.trim()
    ? categories.filter(category =>
        normalizeText(category.label).includes(normalizeText(categorySearch)) ||
        normalizeText(category.slug).includes(normalizeText(categorySearch))
      )
    : categories;

 return (
    <div ref={appRootRef} className={cx("min-h-screen", T.pageBg, T.pageText)}>
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl md:text-3xl font-bold">Tier list 2D — {state.categoryLabel}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                const vAxis = state.axes.find(a => a.id === state.activeVerticalAxisId)!;
                const hAxis = state.axes.find(a => a.id === state.activeHorizontalAxisId)!;
                const items = Object.fromEntries(
                  Object.entries(state.items).map(([id, item]) => [
                    id,
                    {
                      ...item,
                      axisPositions: Object.fromEntries(
                        state.axes.map(axis => [axis.id, null])
                      ) as Record<string, number | null>,
                    },
                  ])
                );
                const containers = rebuildContainersForAxes(
                  items,
                  state.activeVerticalAxisId,
                  state.activeHorizontalAxisId,
                  vAxis.tiers.length,
                  hAxis.tiers.length
                );
                // Remettre tous les items au pool
                const allIds = Object.keys(items);
                containers[state.poolId] = sortIdsAlpha(allIds, items);
                for (const key in containers) {
                  if (key !== state.poolId) containers[key] = [];
                }
                setState(s => ({ ...s, items, containers }));
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
          <CardHeader>
            <CardTitle>Catégorie</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className={INPUT_DARK + " w-64"}
                value={categoryInput}
                onChange={(e) => setCategoryInput(e.target.value)}
                placeholder="Rap français, JV, cinéma..."
              />
              <Button variant="outline" className={OUTLINE_DARK} onClick={() => applyCategory(categoryInput)}>
                Renommer
              </Button>
              <Button variant="outline" className={OUTLINE_DARK} onClick={createCategory}>
                <Plus className="w-4 h-4 mr-2" /> Créer une catégorie
              </Button>
              <Button variant="outline" className={OUTLINE_DARK} onClick={shareCategoryURL}>
                <Link2 className="w-4 h-4 mr-2" /> Partager la catégorie
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className={cx("text-sm", T.mutedText)}>
                Seeds publiques de <strong className="text-zinc-100">{state.categoryLabel}</strong>
              </span>
              <Button variant="outline" className={OUTLINE_DARK} size="sm" onClick={() => refreshCategorySeeds()}>
                {loadingCategorySeeds ? "Chargement..." : "Rafraîchir"}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {categorySeeds.length ? categorySeeds.map(seed => (
                <Button
                  key={`${seed.categorySlug}-${seed.id}`}
                  variant="outline"
                  className={OUTLINE_DARK}
                  size="sm"
                  onClick={() => loadSeed(seed.id, seed.categorySlug)}
                  title={seed.uploadedAt ? new Date(seed.uploadedAt).toLocaleString("fr-FR") : undefined}
                >
                  {seed.id.slice(0, 8)}
                </Button>
              )) : (
                <span className={cx("text-sm", T.mutedText)}>
                  {loadingCategorySeeds ? "Chargement des seeds..." : "Aucune seed publique dans cette catégorie."}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between gap-2">
            <CardTitle>Navigation catégories</CardTitle>
            <Button variant="outline" className={OUTLINE_DARK} size="sm" onClick={() => setShowCategoryBrowser(v => !v)}>
              {showCategoryBrowser ? "Masquer" : "Afficher"}
            </Button>
          </CardHeader>
          {showCategoryBrowser && (
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className={INPUT_DARK + " w-64"}
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  placeholder="Nom de categorie"
                />
                <Button variant="outline" className={OUTLINE_DARK} onClick={goToCategoryByName}>
                  Aller
                </Button>
                <Button variant="outline" className={OUTLINE_DARK} onClick={refreshCategories}>
                  {loadingCategories ? "Chargement..." : "Rafraichir"}
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {filteredCategories.length ? filteredCategories.map(category => (
                  <button
                    key={category.slug}
                    type="button"
                    onClick={() => navigateToCategory(category)}
                    className={cx(
                      "text-left rounded-md border p-3 transition",
                      category.slug === state.categorySlug
                        ? "border-indigo-400 bg-indigo-500/10"
                        : "border-zinc-700 hover:bg-zinc-800"
                    )}
                  >
                    <div className="font-semibold">{category.label}</div>
                    <div className={cx("text-xs", T.mutedText)}>
                      {category.seedCount} seed{category.seedCount > 1 ? "s" : ""}
                      {category.updatedAt ? ` - ${new Date(category.updatedAt).toLocaleDateString("fr-FR")}` : ""}
                    </div>
                  </button>
                )) : (
                  <span className={cx("text-sm", T.mutedText)}>
                    {loadingCategories ? "Chargement des categories..." : "Aucune categorie trouvee."}
                  </span>
                )}
              </div>
            </CardContent>
          )}
        </Card>

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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                <div>
                  <Label className="mb-2 block">Axe couleur (cadre)</Label>
                  <select
                    className={cx("w-full p-2 rounded", INPUT_DARK)}
                    value={state.activeColorAxisId || ""}
                    onChange={(e) => switchColorAxis(e.target.value)}
                  >
                    <option value="">Aucun</option>
                    {state.axes
                      .filter(axis => axis.id !== state.activeVerticalAxisId && axis.id !== state.activeHorizontalAxisId)
                      .map(axis => (
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
                              <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                                <input
                                  type="checkbox"
                                  checked={!tier.hidden}
                                  onChange={(e) => updateTier(axis.id, i, { hidden: !e.target.checked })}
                                />
                                Visible
                              </label>
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
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(state.tileLinksEnabled)}
                  onChange={(e) => setState(s => ({ ...s, tileLinksEnabled: e.target.checked }))}
                />
                Liens sur les noms
              </label>
              <div className="flex flex-col gap-1 min-w-72">
                <Input
                  className={INPUT_DARK + " w-80 max-w-full"}
                  value={state.tileLinkTemplate || DEFAULT_TILE_LINK_TEMPLATE}
                  onChange={(e) => setState(s => ({ ...s, tileLinkTemplate: e.target.value }))}
                  placeholder="https://www.google.com/search?q={name}"
                  title="Utilisez {name} pour insérer le nom encodé. Exemples : https://www.google.com/search?q={name} ou https://www.youtube.com/results?search_query={name}"
                />
                <span className="text-[10px] leading-tight text-zinc-400">
                  Mets {"{name}"} ou laisse juste un prefixe : le nom de la tuile sera ajoute a la fin.
                </span>
              </div>
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
          <div
            className={cx(
              isPoolPinned && poolSplitSide
                ? "grid gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(0,2fr)] lg:h-[calc(100vh-1.5rem)] lg:min-h-[620px]"
                : isPoolPinned
                  ? "grid gap-4 h-[calc(100vh-1.5rem)] min-h-[620px] grid-rows-[minmax(0,2fr)_minmax(240px,1fr)]"
                  : "space-y-6"
            )}
          >
            <div className={cx(
              isPoolPinned && "min-h-0 flex flex-col gap-4 pr-1 overflow-hidden",
              isPoolPinned && poolSplitSide && "lg:order-2"
            )}>
          {colorAxis && (
            <div className={cx("rounded-2xl border p-3", T.cardBg, T.cardBorder)}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-sm font-semibold">{colorAxis.label}</div>
                {colorAxis.tiers.map((tier, index) => (
                  <div key={`${colorAxis.id}-legend-${index}`} className="flex items-center gap-2 text-sm">
                    <span
                      className="h-4 w-4 rounded-full border border-zinc-600"
                      style={{ backgroundColor: tier.color }}
                    />
                    <span>{tier.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={cx("overflow-auto rounded-2xl border", T.cardBg, T.cardBorder, isPoolPinned && "min-h-0 flex-1")}>
            <div className="grid gap-2 p-2" style={gridTemplate}>
              <div />
              
              <div
                className={cx("sticky top-0 z-10 rounded-xl p-2 text-sm font-semibold border", T.cardBorder)}
                style={{ backgroundColor: "#6b7280", color: "#ffffff" }}
              >
                À classer
              </div>
              <SortableContext items={visibleHTiers.map(({ index }) => tierDragId(hAxis.id, index))} strategy={rectSortingStrategy}>
                {visibleHTiers.map(({ tier, index }) => (
                  <SortableTierHeader
                    key={`colh-${index}`}
                    id={tierDragId(hAxis.id, index)}
                    label={tier.label}
                    color={tier.color}
                    onRename={(label) => updateTier(hAxis.id, index, { label })}
                    className={cx("sticky top-0 z-10 rounded-xl p-2 text-sm font-semibold border", T.cardBorder)}
                  />
                ))}
              </SortableContext>

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
                                colorFrame={getColorFrame(itemId)}
                                colorAxis={colorAxis}
                                onColorCycle={cycleColorAxisPosition}
                                tileLink={getTileLink(itemId)}
                          onEdit={updateItemDetails}
                                showInfo={showInfoId === itemId}
                                onInfoToggle={(id) => {
                                  setOpenCommentId(null);
                                  setIsEditingComment(false);
                                  setShowInfoId(prev => prev === id ? null : id);
                                }}
                                  />
                            ))}
                          </div>
                        </Droppable>
                      </SortableContext>
                    </CardContent>
                  </Card>
                );
              })()}

              {visibleHTiers.map(({ index }) => {
                const id = `r-1-c${index}`;
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
                                colorFrame={getColorFrame(itemId)}
                                colorAxis={colorAxis}
                                onColorCycle={cycleColorAxisPosition}
                                tileLink={getTileLink(itemId)}
                          onEdit={updateItemDetails}
                                showInfo={showInfoId === itemId}
                                onInfoToggle={(id) => {
                                  setOpenCommentId(null);
                                  setIsEditingComment(false);
                                  setShowInfoId(prev => prev === id ? null : id);
                                }}
                                  />
                            ))}
                          </div>
                        </Droppable>
                      </SortableContext>
                    </CardContent>
                  </Card>
                );
              })}

              <SortableContext items={visibleVTiers.map(({ index }) => tierDragId(vAxis.id, index))} strategy={rectSortingStrategy}>
                {visibleVTiers.map(({ tier: rowTier, index: ri }) => (
                 <React.Fragment key={`row-${ri}`}>
                    <SortableTierHeader
                      id={tierDragId(vAxis.id, ri)}
                      label={rowTier.label}
                      color={rowTier.color}
                      onRename={(label) => updateTier(vAxis.id, ri, { label })}
                      className={cx("sticky left-0 z-10 rounded-xl p-2 text-sm font-semibold border", T.cardBorder)}
                    />

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
                                colorFrame={getColorFrame(itemId)}
                                colorAxis={colorAxis}
                                onColorCycle={cycleColorAxisPosition}
                                tileLink={getTileLink(itemId)}
                          onEdit={updateItemDetails}
                                showInfo={showInfoId === itemId}
                                onInfoToggle={(id) => {
                                  setOpenCommentId(null);
                                  setIsEditingComment(false);
                                  setShowInfoId(prev => prev === id ? null : id);
                                }}
                                  />
                                ))}
                              </div>
                            </Droppable>
                          </SortableContext>
                        </CardContent>
                      </Card>
                    );
                  })()}

                  {visibleHTiers.map(({ index: ci }) => {
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
                                colorFrame={getColorFrame(itemId)}
                                colorAxis={colorAxis}
                                onColorCycle={cycleColorAxisPosition}
                                tileLink={getTileLink(itemId)}
                          onEdit={updateItemDetails}
                                showInfo={showInfoId === itemId}
                                onInfoToggle={(id) => {
                                  setOpenCommentId(null);
                                  setIsEditingComment(false);
                                  setShowInfoId(prev => prev === id ? null : id);
                                }}
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
              </SortableContext>
            </div>
          </div>

          {!isPoolPinned && (
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Bac (non classés)</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={isPoolPinned}
                    onChange={(e) => setIsPoolPinned(e.target.checked)}
                  />
                  Figer le bac
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={poolSplitSide}
                    disabled={!isPoolPinned}
                    onChange={(e) => setPoolSplitSide(e.target.checked)}
                  />
                  Gauche / droite
                </label>
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
                <Button
                  variant="outline"
                  className={OUTLINE_DARK}
                  size="sm"
                  disabled={!poolIds.length}
                  onClick={deletePoolItems}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Vider le bac
                </Button>
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
                                colorFrame={getColorFrame(itemId)}
                                colorAxis={colorAxis}
                                onColorCycle={cycleColorAxisPosition}
                                tileLink={getTileLink(itemId)}
                          onEdit={updateItemDetails}
                                showInfo={showInfoId === itemId}
                                onInfoToggle={(id) => {
                                  setOpenCommentId(null);
                                  setIsEditingComment(false);
                                  setShowInfoId(prev => prev === id ? null : id);
                                }}
                                  />
                    ))}
                  </div>
                </Droppable>
              </SortableContext>
            </CardContent>
          </Card>
          )}
            </div>

            <div className={cx(
              isPoolPinned && "min-h-0 overflow-hidden",
              isPoolPinned && poolSplitSide && "lg:order-1"
            )}>
              {isPoolPinned ? poolCard : null}
            </div>
          </div>

          {openCommentId && (
            <div
              data-comment-panel="1"
              ref={commentRef}
              className="fixed z-50 w-[min(520px,calc(100vw-2rem))] rounded-xl bg-white text-zinc-900 border border-zinc-300 shadow-2xl"
              style={{
                left: `${commentPanelPosition.x}px`,
                top: `${commentPanelPosition.y}px`,
              }}
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
            {activeId && state.items[activeId] ? (
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
                                colorFrame={getColorFrame(activeId)}
                                colorAxis={colorAxis}
                                onColorCycle={cycleColorAxisPosition}
                                tileLink={getTileLink(activeId)}
                                onEdit={updateItemDetails}
                                showInfo={showInfoId === activeId}
                                onInfoToggle={(id) => {
                                  setOpenCommentId(null);
                                  setIsEditingComment(false);
                                  setShowInfoId(prev => prev === id ? null : id);
                                }}
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
              <code>Nom;URL;Commentaire</code>. Une liste avec seulement les noms marche aussi : le bouton Wikipedia peut remplir les images manquantes. Google Sheets : collez un tableau avec{" "}<code>Nom | Image | Axe 1 | Axe 2... | Commentaire</code> en première ligne. Dans un axe, <code>X</code> envoie la tuile dans À classer.
            </p>
            <Textarea
              className={cx("w-full resize-y", INPUT_DARK)}
              rows={6}
              value={pairsText}
              onChange={(e) => setPairsText(e.target.value)}
              onPaste={(e) => {
                const html = e.clipboardData.getData("text/html");
                const tableText = clipboardRowsFromHtml(html);
                if (!tableText) return;
                e.preventDefault();
                setPairsText(tableText);
              }}
              placeholder={`Ex. simple\nNekfeu\thttps://exemple.com/nekfeu.jpg Un court commentaire\n\nEx. Google Sheets\nNom\tImage\tTalent\tStyle\tCommentaire\nNekfeu\thttps://exemple.com/nekfeu.jpg\tExcellent\tStreet\tNote perso\nPNL\t\tX\tPlanant\t`}
            />
            {pairsText.trim() && (
              <div className={cx("rounded-md border px-3 py-2 text-xs", T.cardBorder, T.mutedText)}>
                Colonnes detectees : <strong className="text-zinc-100">{importPreviewHeaders.length || 1}</strong>
                {importPreviewColumns ? (
                  <>
                    {" "} | Axes : <strong className="text-zinc-100">{importPreviewColumns.axisColumns.map(col => col.header || `Axe ${col.index}`).join(", ")}</strong>
                    {importPreviewColumns.commentIndex >= 0 && <> | Commentaire : colonne {importPreviewColumns.commentIndex + 1}</>}
                  </>
                ) : (
                  <> | Tableau Google Sheets non detecte</>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={importPairs}>
                <Upload className="w-4 h-4 mr-2" />
                Importer
              </Button>
              <Button
                variant="outline"
                className={OUTLINE_DARK}
                disabled={loadingWikiImages || loadingGoogleImages || loadingSerpImages || loadingPinterestImages || loadingBrightDataImages || !pairsText.trim()}
                onClick={prefillWikipediaImages}
              >
                {loadingWikiImages ? "Recherche Wikipedia..." : "Pré-remplir images Wikipedia"}
              </Button>
              <Button
                variant="outline"
                className={OUTLINE_DARK}
                disabled={loadingGoogleImages || loadingWikiImages || loadingSerpImages || loadingPinterestImages || loadingBrightDataImages || !pairsText.trim()}
                onClick={prefillGoogleImages}
                title="Utilise Google Custom Search. Variables Vercel requises : GOOGLE_CUSTOM_SEARCH_API_KEY et GOOGLE_CUSTOM_SEARCH_CX."
              >
                {loadingGoogleImages ? "Recherche Google..." : "Pré-remplir images Google"}
              </Button>
              <Button
                variant="outline"
                className={OUTLINE_DARK}
                disabled={loadingSerpImages || loadingWikiImages || loadingGoogleImages || loadingPinterestImages || loadingBrightDataImages || !pairsText.trim()}
                onClick={prefillSerpImages}
                title="Utilise SerpAPI Google Images. Variable Vercel requise : SERPAPI_API_KEY."
              >
                {loadingSerpImages ? "Recherche SerpAPI..." : "Pré-remplir images SerpAPI"}
              </Button>
              <Button
                variant="outline"
                className={OUTLINE_DARK}
                disabled={loadingPinterestImages || loadingSerpImages || loadingWikiImages || loadingGoogleImages || loadingBrightDataImages || !pairsText.trim()}
                onClick={prefillPinterestImages}
                title="Utilise SerpAPI avec une recherche limitee a Pinterest. Consomme aussi une requete SerpAPI par tuile."
              >
                {loadingPinterestImages ? "Recherche Pinterest..." : "Pre-remplir images Pinterest"}
              </Button>
              <Button
                variant="outline"
                className={OUTLINE_DARK}
                disabled={loadingBrightDataImages || loadingPinterestImages || loadingSerpImages || loadingWikiImages || loadingGoogleImages || !pairsText.trim()}
                onClick={prefillBrightDataImages}
                title="Utilise Bright Data SERP API. Variables supportees : Brightdata_SerpAPI_Key ou BRIGHTDATA_SERP_API_KEY."
              >
                {loadingBrightDataImages ? "Recherche Bright Data..." : "Pre-remplir images Bright Data"}
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
