// @ts-check
/**
 * Build-time META TEAMS generator.
 *
 * Pokémon Champions has no "teams" endpoint on Smogon — the chaos stats only
 * expose per-Pokémon co-usage. So the app's Meta Teams are REAL, whole teams
 * lifted from Smogon's official "Champions VGC Regulation … Sample Teams" forum
 * thread: teams collated from TPCi events + large grassroots tournaments, each
 * credited to a real player and result. We bake them so nothing is invented and
 * the running app makes zero network calls (the sprites still come from the CDN
 * the service worker caches).
 *
 * Per team we distill: the archetype codename, the author/event/placement
 * credit, the PokéPaste source, and every one of the six sets (species + form,
 * item, ability, nature, EV spread, four moves) — enriched with each member's
 * current Master+ ladder usage so teams can be ordered by their "meta footprint"
 * (how much of the current ladder their core represents).
 *
 * Output: src/data/generated/teams.json (committed). `generatedAt` is pinned to
 * competitive.json's so `npm run status` date-agreement check stays green.
 * Run with: `npm run data:teams`  (needs pokemon.json + competitive.json first).
 *
 * If the thread / pastes can't be fetched, the last committed teams.json is kept
 * (salvage), so a transient network blip never hard-fails `npm run refresh`.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POKEMON_PATH = resolve(ROOT, "src/data/generated/pokemon.json");
const COMPETITIVE_PATH = resolve(ROOT, "src/data/generated/competitive.json");
const OUT_PATH = resolve(ROOT, "src/data/generated/teams.json");

const USER_AGENT = "Mozilla/5.0 (compatible; ChampionsPokedexBuild/1.0)";

// The Smogon sample-teams thread is per-REGULATION (it rarely rotates — once a
// game regulation, not monthly). Its forum id isn't derivable from the stats
// format id, so map the current formats we know. When the game rotates to a new
// regulation, add one line here (or pin TEAMS_THREAD=<url> for a one-off) — the
// generator warns loudly and salvages the committed data until then, so a
// rotation never hard-fails the refresh; it just flags "teams are a reg behind".
const KNOWN_THREADS = {
  gen9championsvgc2026regmb:
    "https://www.smogon.com/forums/threads/champions-vgc-regulation-m-b-sample-teams.3785112/",
  gen9championsvgc2026regma:
    "https://www.smogon.com/forums/threads/champions-vgc-regulation-m-a-sample-teams.3782777/",
};
const THREAD_OVERRIDE = process.env.TEAMS_THREAD || null;

// How many teams the /teams page highlights as the headline "Top" set. The rest
// are still baked (and get detail pages) so the honest, larger source is never
// hidden — the page just features the top N.
const TOP_N = 5;

/** "gen9championsvgc2026regmb" → "Reg M-B" (best-effort; raw id if unparseable). */
function regulationLabel(format) {
  const m = format.match(/reg([a-z])([a-z])$/);
  return m ? `Reg ${m[1].toUpperCase()}-${m[2].toUpperCase()}` : format;
}

async function getText(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    if (attempt >= 6) throw err;
    await new Promise((r) => setTimeout(r, 700 * attempt));
    return getText(url, attempt + 1);
  }
}

const decodeEntities = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, "'")
    .replace(/&nbsp;|&#8203;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const stripTags = (s) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** A team's canonical base-species set — the position-independent join key
 *  between a thread descriptor line and a PokéPaste's contents. */
const baseSpecies = (slug) =>
  slug
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(
      /-(mega(-[xy])?|primal|x|y|alola|galar|hisui|paldea|eternal|dusk|dawn|midnight|midday|female|male|hero|zero|blade|shield|origin|therian|incarnate|aqua|combat|blaze|f|m|average|small|large|super|standard)$/g,
      "",
    )
    .split("-")[0];

// --- Thread parsing --------------------------------------------------------------

/**
 * Pull the first post's descriptor lines (six minisprites + " - Name, credit")
 * and every PokéPaste id, from the sample-teams thread HTML.
 */
function parseThread(html) {
  const msg = html.match(/class="bbWrapper">([\s\S]*?)<\/article>/);
  const body = msg ? msg[1] : html;

  // Descriptor lines: split on <br>, keep lines carrying exactly six minisprites.
  const descriptors = [];
  for (const line of body.split(/<br\s*\/?>/i)) {
    const alts = [...line.matchAll(/alt=':([a-z0-9-]+):'/g)].map((m) => m[1]);
    if (alts.length !== 6) continue;
    // Title = the text after the last minisprite <img>, minus a trailing "<a".
    const imgs = [...line.matchAll(/<img[^>]*>/g)];
    const tail = imgs.length ? line.slice(imgs[imgs.length - 1].index + imgs[imgs.length - 1][0].length) : line;
    const title = stripTags(tail).replace(/\s*<?a?\s*$/i, "").replace(/^[\s\-–—]+/, "").trim();
    descriptors.push({ alts, baseSet: new Set(alts.map(baseSpecies)), title });
  }

  const pasteIds = [...new Set([...body.matchAll(/pokepast\.es\/([a-z0-9]+)/g)].map((m) => m[1]))];
  return { descriptors, pasteIds };
}

const setKey = (arr) => [...arr].sort().join("|");

// --- PokéPaste parsing -----------------------------------------------------------

/** Parse a Showdown export block into structured sets (faithful to the source). */
function parsePaste(text) {
  const sets = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trimEnd());
    if (!lines.length || !lines[0].trim()) continue;
    const head = lines[0].trim();
    if (!/@|^[A-Z]/.test(head)) continue;

    // "Species (Nickname) (M) @ Item" — species is what precedes the first of
    // (nickname/gender/@). Nicknames appear as "Nickname (Species) (M) @ Item".
    let rest = head;
    let item = null;
    const at = rest.split(" @ ");
    if (at.length > 1) item = at[1].trim();
    let namePart = at[0].trim();
    let gender = null;
    const gm = namePart.match(/\s\(([MF])\)\s*$/);
    if (gm) {
      gender = gm[1];
      namePart = namePart.slice(0, gm.index).trim();
    }
    // If there's a parenthesized token left, it's "Nickname (Species)".
    const nick = namePart.match(/^(.+?)\s\(([^)]+)\)\s*$/);
    const species = nick ? nick[2].trim() : namePart;
    if (!species) continue;

    const set = { species, item, gender, ability: null, nature: null, level: null, evs: {}, ivs: {}, moves: [], teratype: null };
    for (const l of lines.slice(1)) {
      const t = l.trim();
      if (t.startsWith("Ability:")) set.ability = t.slice(8).trim();
      else if (t.startsWith("Level:")) set.level = Number(t.slice(6).trim()) || null;
      else if (/Nature$/.test(t)) set.nature = t.replace(/\s*Nature$/, "").trim();
      else if (t.startsWith("EVs:")) set.evs = parseStatLine(t.slice(4));
      else if (t.startsWith("IVs:")) set.ivs = parseStatLine(t.slice(4));
      else if (t.startsWith("Tera Type:")) set.teratype = t.slice(10).trim();
      else if (t.startsWith("- ")) set.moves.push(t.slice(2).trim());
    }
    sets.push(set);
  }
  return sets;
}

const STAT_KEY = { HP: "hp", Atk: "atk", Def: "def", SpA: "spa", SpD: "spd", Spe: "spe" };
function parseStatLine(s) {
  const out = {};
  for (const part of s.split("/")) {
    const m = part.trim().match(/^(\d+)\s+(HP|Atk|Def|SpA|SpD|Spe)$/);
    if (m) out[STAT_KEY[m[2]]] = Number(m[1]);
  }
  return out;
}

// --- Member resolution (species → roster form: sprite / types / route) -----------

function buildResolver(pokemon) {
  const byName = new Map(pokemon.map((p) => [p.name, p]));
  const byFormKey = new Map();
  for (const p of pokemon) for (const f of p.forms ?? []) byFormKey.set(f.key, { p, f });

  const iconOf = (obj, base) => obj.home ?? obj.artwork ?? obj.sprite ?? base?.home ?? base?.artwork ?? base?.sprite ?? null;

  /**
   * Resolve a form slug (from the thread minisprite alt, e.g. "charizard-mega-y")
   * to a route slug + form key + display label + types + sprite.
   */
  return function resolve(altSlug) {
    // 1) Its own roster entry (regional forms, Rotom appliances live as species).
    if (byName.has(altSlug)) {
      const p = byName.get(altSlug);
      return { slug: p.name, formKey: null, name: p.displayName, formLabel: p.displayName, types: p.types, sprite: iconOf(p), isMega: false };
    }
    // 2) A modeled battle form (Mega / stance) of some species.
    if (byFormKey.has(altSlug)) {
      const { p, f } = byFormKey.get(altSlug);
      const isMega = f.kind === "mega" || f.kind === "primal";
      return {
        slug: p.name,
        formKey: f.key,
        name: p.displayName,
        formLabel: f.label,
        types: f.types,
        sprite: f.artwork ?? f.sprite ?? iconOf(p),
        isMega,
        // A Mega's in-battle ability is fixed (Mega Charizard Y → Drought), but a
        // paste lists the PRE-Mega base ability (Blaze) by Showdown convention.
        // For a scouting card the Mega's own ability is what matters, so surface it.
        megaAbility: isMega ? f.abilities?.[0]?.displayName ?? null : null,
      };
    }
    // 3) An unmodeled form (e.g. lycanroc-dusk) — fall back to the base species.
    const base = baseSpecies(altSlug);
    if (byName.has(base)) {
      const p = byName.get(base);
      const label = altSlug
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      return { slug: p.name, formKey: null, name: p.displayName, formLabel: label, types: p.types, sprite: iconOf(p), isMega: /-mega/.test(altSlug) };
    }
    // 4) Not in the roster at all — keep the name, no sprite (shouldn't happen).
    return { slug: null, formKey: null, name: null, formLabel: null, types: [], sprite: null, isMega: false };
  };
}

// --- Archetype + credit parsing --------------------------------------------------

// Archetype codewords the sample teams use, longest first so "Bulky Offense" and
// "Trick Room" win over "Offense"/"Room". A weather/strategy tint (a Pokémon
// type) drives the tag color; play-style archetypes stay neutral (red is
// threat-only in this app, so an "Offense" tag never reads red).
const ARCHETYPES = [
  { label: "Dual Weather", type: "water" },
  { label: "Perish Trap", type: "ghost" },
  { label: "Trick Room", type: "psychic" },
  { label: "Bulky Offense", type: null },
  { label: "Set Up", type: null },
  { label: "Rain", type: "water" },
  { label: "Sun", type: "fire" },
  { label: "Sand", type: "rock" },
  { label: "Snow", type: "ice" },
  { label: "Hail", type: "ice" },
  { label: "Balance", type: null },
  { label: "Offense", type: null },
];

function archetypeOf(name) {
  for (const a of ARCHETYPES) {
    if (new RegExp(`\\b${a.label}\\b`, "i").test(name)) return { archetype: a.label, archetypeType: a.type };
  }
  return { archetype: null, archetypeType: null };
}

/** "Shohei Kimura's Season M-3 Rank #1 team" → structured credit + a rank score. */
function parseCredit(title) {
  const isRecreation = /\(recreation\)/i.test(title);
  const clean = title.replace(/\s*\(recreation\)\s*/i, " ").trim();

  // A team NAME can itself contain commas (it lists mons: "Mega Charizard Y,
  // Toxapex + Annihilape Offense"), so we can't split on the first comma. The
  // credit is the trailing run of comma-segments beginning at the first segment
  // that carries a possessive author ("… Tang's team"). No possessive → the
  // whole title is the name (an uncredited sample team).
  const segs = clean.split(", ");
  const creditStart = segs.findIndex((s) => /\b\S+['’]s\b/.test(s));
  const name = (creditStart === -1 ? clean : segs.slice(0, creditStart).join(", ")).trim();
  const creditRaw =
    creditStart === -1 ? null : segs.slice(creditStart).join(", ").replace(/\s+team\s*$/i, "").trim();

  let author = null;
  let detail = null;
  if (creditRaw) {
    const poss = creditRaw.match(/^(.+?)['’]s(?:\s+(.*))?$/);
    if (poss) {
      author = poss[1].trim();
      detail = poss[2]?.trim() || null;
    } else {
      detail = creditRaw;
    }
  }

  // A rough prestige score, ONLY for ordering — every card shows its real
  // result, so the exact order among top finishers isn't load-bearing.
  let placeScore = 0;
  const src = creditRaw ?? "";
  const rank = src.match(/rank\s*#\s*(\d+)/i);
  const place = src.match(/(\d+)(?:st|nd|rd|th)\s*place/i);
  const top = src.match(/top\s*(\d+)/i);
  if (/\b1st place|\bwon\b|winner|champion/i.test(src)) placeScore = 100;
  else if (place) placeScore = Math.max(1, 100 - Number(place[1]) * 2);
  else if (rank) placeScore = Math.max(1, 100 - Number(rank[1]));
  else if (top) placeScore = Math.max(1, 90 - Number(top[1]));
  else if (author) placeScore = 15; // credited player, no explicit placement

  return { name, isRecreation, credit: creditRaw ? { raw: creditRaw, author, detail } : null, placeScore };
}

const slugify = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\+/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// --- Main ------------------------------------------------------------------------

async function salvage(reason) {
  console.warn(`  ~ ${reason} — keeping the committed teams.json`);
  try {
    await readFile(OUT_PATH, "utf8");
    console.log("✓ Salvaged: committed teams.json left in place");
    return true;
  } catch {
    console.error("✗ No committed teams.json to salvage — /teams would be empty");
    return false;
  }
}

async function main() {
  const [pokemonData, competitive] = await Promise.all([
    readFile(POKEMON_PATH, "utf8").then(JSON.parse),
    readFile(COMPETITIVE_PATH, "utf8").then(JSON.parse),
  ]);
  const pokemon = pokemonData.pokemon;
  const format = competitive.meta.format;
  const label = regulationLabel(format);

  const threadUrl = THREAD_OVERRIDE ?? KNOWN_THREADS[format] ?? null;
  if (!threadUrl) {
    const ok = await salvage(
      `no sample-teams thread known for ${format} (${label}); add it to KNOWN_THREADS in scripts/generate-teams.mjs or pin TEAMS_THREAD=<url>`,
    );
    process.exit(ok ? 0 : 1);
  }
  console.log(`Fetching Champions Meta Teams (${format} = ${label})…`);
  console.log(`  Source: ${threadUrl}`);

  let descriptors, pasteIds;
  try {
    ({ descriptors, pasteIds } = parseThread(await getText(threadUrl)));
  } catch (err) {
    const ok = await salvage(`could not fetch the sample-teams thread (${err.message})`);
    process.exit(ok ? 0 : 1);
  }
  if (!descriptors.length || !pasteIds.length) {
    const ok = await salvage("the sample-teams thread had no parseable teams (layout changed?)");
    process.exit(ok ? 0 : 1);
  }

  // Fetch every paste, parse its sets, and index by canonical base-species set.
  const pastes = [];
  for (const id of pasteIds) {
    let sets;
    try {
      sets = parsePaste(await getText(`https://pokepast.es/${id}/raw`));
    } catch (err) {
      console.warn(`  ~ skipped paste ${id} (${err.message})`);
      continue;
    }
    if (sets.length !== 6) {
      console.warn(`  ~ skipped paste ${id} (${sets.length} sets, expected 6)`);
      continue;
    }
    pastes.push({ id, sets, baseSet: new Set(sets.map((s) => baseSpecies(s.species))) });
  }

  const resolveMember = buildResolver(pokemon);
  const usageOf = (formKey, slug) => {
    const m = competitive.brackets.master ?? {};
    const a = competitive.brackets.all ?? {};
    for (const b of [m, a]) {
      const p = (formKey && b[formKey]) || (slug && b[slug]);
      if (p?.usagePct != null) return p.usagePct;
    }
    return null;
  };

  // Join each PokéPaste to its thread descriptor by species set (position-proof).
  const descByKey = new Map(descriptors.map((d) => [setKey(d.baseSet), d]));
  const teams = [];
  const usedSlugs = new Set();
  for (const paste of pastes) {
    const desc = descByKey.get(setKey(paste.baseSet));
    if (!desc) {
      console.warn(`  ~ paste ${paste.id} matched no thread descriptor — skipped`);
      continue;
    }
    const { name, isRecreation, credit, placeScore } = parseCredit(desc.title);
    const { archetype, archetypeType } = archetypeOf(name);

    // Align each set to a thread alt (which carries the resolved form) by base
    // species, so we know Charizard is Mega-Y and Floette is its Mega form.
    const remainingAlts = [...desc.alts];
    const members = paste.sets.map((set) => {
      const b = baseSpecies(set.species);
      let ai = remainingAlts.findIndex((a) => baseSpecies(a) === b);
      const alt = ai === -1 ? set.species.toLowerCase().replace(/\s+/g, "-") : remainingAlts.splice(ai, 1)[0];
      const r = resolveMember(alt);
      const evStr = Object.entries(set.evs)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${v} ${{ hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" }[k]}`)
        .join(" / ");
      return {
        slug: r.slug,
        formKey: r.formKey,
        name: r.name ?? set.species,
        formLabel: r.formLabel ?? set.species,
        types: r.types,
        sprite: r.sprite,
        isMega: r.isMega,
        item: set.item,
        // Megas show their post-evolution ability (Drought), not the paste's
        // pre-Mega base ability; everyone else keeps their paste-chosen ability.
        ability: (r.isMega && r.megaAbility) || set.ability,
        nature: set.nature,
        evs: set.evs,
        evStr,
        moves: set.moves,
        gender: set.gender,
        usagePct: usageOf(r.formKey, r.slug),
      };
    });

    const metaFootprint = Math.round(members.reduce((s, m) => s + (m.usagePct ?? 0), 0) * 10) / 10;

    let slug = slugify(name);
    if (usedSlugs.has(slug)) slug = `${slug}-${paste.id.slice(0, 4)}`;
    usedSlugs.add(slug);

    teams.push({
      slug,
      name,
      archetype,
      archetypeType,
      credit,
      isRecreation,
      pasteUrl: `https://pokepast.es/${paste.id}`,
      metaFootprint,
      placeScore,
      members,
    });
  }

  if (!teams.length) {
    const ok = await salvage("no teams survived paste↔thread matching");
    process.exit(ok ? 0 : 1);
  }

  // Order by real tournament pedigree first (a credited top finish is a genuine
  // "top meta team"; a footprint sum is our own metric), tie-broken by meta
  // footprint — how much of the current ladder the core represents. The page
  // features the top N; the rest are still baked and get detail pages, so the
  // honest source is never truncated.
  teams.sort((a, b) => b.placeScore - a.placeScore || b.metaFootprint - a.metaFootprint);
  teams.forEach((t, i) => {
    t.rank = i + 1;
    delete t.placeScore; // an ordering detail, not shipped
  });

  const out = {
    meta: {
      format,
      regulationLabel: label,
      source: threadUrl,
      sourceLabel: `Smogon Champions ${label} Sample Teams`,
      // Pinned to the competitive snapshot so `npm run status` date-agreement holds.
      generatedAt: competitive.meta.generatedAt,
      topN: TOP_N,
      count: teams.length,
    },
    teams,
  };
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");

  const unresolved = teams.flatMap((t) => t.members).filter((m) => !m.slug).length;
  console.log(`✓ Wrote ${teams.length} meta teams (top ${TOP_N} featured)`);
  if (unresolved) console.warn(`  ~ ${unresolved} member(s) didn't resolve to a roster mon`);
  console.log(`  Top: ${teams.slice(0, TOP_N).map((t) => t.name).join(" · ")}`);
}

main().catch((err) => {
  console.error("Meta teams generation failed:", err);
  process.exit(1);
});
