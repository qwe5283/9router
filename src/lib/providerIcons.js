import { readdirSync } from "node:fs";
import path from "node:path";
import REGISTRY from "open-sse/providers/registry/index.js";
import { getProviderIconSrc, resolveProviderIconId } from "@/shared/utils/providerIcon";

const ICON_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const ICON_NAMES = {
  "oai-cc": "OpenAI Chat Completions",
  "oai-r": "OpenAI Responses",
  "anthropic-m": "Anthropic Compatible",
  ...Object.fromEntries(REGISTRY.map((p) => [p.id, p.display?.name || p.id])),
};

export function getProviderIconOptions() {
  const files = readdirSync(path.join(process.cwd(), "public", "providers"), { withFileTypes: true });
  const ids = new Set(files.filter((f) => f.isFile() && f.name.endsWith(".png"))
    .map((f) => f.name.slice(0, -4)).filter((id) => ICON_ID_RE.test(id)));
  const icons = new Map();
  for (const id of ids) {
    const canonical = resolveProviderIconId(id);
    if (!ids.has(canonical)) continue;
    icons.set(canonical, {
      id: canonical,
      name: ICON_NAMES[canonical] || canonical.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
      src: getProviderIconSrc(canonical),
    });
  }
  return [...icons.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function normalizeProviderNodeIconId(value) {
  if (value === undefined) return { iconId: undefined };
  if (value === null || value === "") return { iconId: null };
  if (typeof value !== "string") return { error: "Invalid provider avatar" };
  const iconId = resolveProviderIconId(value);
  if (!ICON_ID_RE.test(iconId) || !getProviderIconOptions().some((icon) => icon.id === iconId)) {
    return { error: "Choose an avatar from the available providers" };
  }
  return { iconId };
}
