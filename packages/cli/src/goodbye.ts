import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const glyphs: Record<string, string[]> = {
    N: ["█  █", "██ █", "█ ██", "█  █"],
    I: ["████", " ██ ", " ██ ", "████"],
    G: [" ██ ", "█   ", "█ ██", " ███"],
    H: ["█  █", "████", "█  █", "█  █"],
    T: ["████", " ██ ", " ██ ", " ██ "],
    C: [" ██ ", "█   ", "█   ", " ██ "],
    O: [" ██ ", "█__█", "█__█", " ██ "],
    D: ["███ ", "█__█", "█__█", "███ "],
    E: ["████", "███ ", "███ ", "████"],
};

const R = "\x1b[0m";

type ThemeColors = {
    primary: string;
    planMode: string;
    dimSeparator: string;
};

const THEMES: Record<string, ThemeColors> = {
    "Nightfox":           { primary: "#56D6C2", planMode: "#CF8EF4", dimSeparator: "#4E4E66" },
    "Catppuccin Mocha":   { primary: "#E0AF68", planMode: "#9D7CD8", dimSeparator: "#585B70" },
    "Dracula":            { primary: "#BD93F9", planMode: "#FF79C6", dimSeparator: "#44475A" },
    "Monokai Pro":        { primary: "#FFD866", planMode: "#AB9DF2", dimSeparator: "#727072" },
    "Tokyo Night":        { primary: "#7AA2F7", planMode: "#BB9AF7", dimSeparator: "#565F89" },
    "Nord":               { primary: "#EBCB8B", planMode: "#B48EAD", dimSeparator: "#616E88" },
    "Synthwave":          { primary: "#F472B6", planMode: "#A855F7", dimSeparator: "#525252" },
    "Midnight Sky":       { primary: "#6AAEF5", planMode: "#B07AE8", dimSeparator: "#607080" },
    "Neon Nights":        { primary: "#E86ACA", planMode: "#5ED4E8", dimSeparator: "#745E90" },
    "Hacker Terminal":    { primary: "#00E5A0", planMode: "#D946EF", dimSeparator: "#454545" },
    "One Dark":           { primary: "#CBAACB", planMode: "#55B6C2", dimSeparator: "#5C6370" },
    "Xcode Midnight":     { primary: "#FF7AB2", planMode: "#6BDFFF", dimSeparator: "#57575F" },
    "Catppuccin Frappe":  { primary: "#8CAAEE", planMode: "#CA9EE6", dimSeparator: "#626880" },
    "Vercel Dark":        { primary: "#8B5CF6", planMode: "#EC4899", dimSeparator: "#374151" },
    "Material Ocean":     { primary: "#82AAFF", planMode: "#C792EA", dimSeparator: "#4B5178" },
    "Dusk":               { primary: "#C9A0DC", planMode: "#F2B866", dimSeparator: "#7E6E94" },
    "Ocean":              { primary: "#3B9ECF", planMode: "#E0A846", dimSeparator: "#5E7888" },
    "Soft Midnight":      { primary: "#60A5FA", planMode: "#F9A8D4", dimSeparator: "#475569" },
    "Minimal Dark":       { primary: "#A78BFA", planMode: "#38BDF8", dimSeparator: "#52525B" },
    "Solarized Dark":     { primary: "#268BD2", planMode: "#6C71C4", dimSeparator: "#657B83" },
    "Gruvbox Dark":       { primary: "#FABD2F", planMode: "#D3869B", dimSeparator: "#665C54" },
    "Rosé Pine":          { primary: "#EBBCBA", planMode: "#C4A7E7", dimSeparator: "#524F67" },
    "Rosé Pine Moon":     { primary: "#EA9A97", planMode: "#C4A7E7", dimSeparator: "#56526E" },
    "Kanagawa":           { primary: "#DCD7BA", planMode: "#957FB8", dimSeparator: "#727169" },
    "Everforest Dark":    { primary: "#A7C080", planMode: "#D699B6", dimSeparator: "#859289" },
    "Ayu Dark":           { primary: "#E6B450", planMode: "#D2A6FF", dimSeparator: "#475266" },
    "GitHub Dark":        { primary: "#79C0FF", planMode: "#D2A8FF", dimSeparator: "#484F58" },
    "Palenight":          { primary: "#82AAFF", planMode: "#C792EA", dimSeparator: "#676E95" },
    "Vesper":             { primary: "#FFC799", planMode: "#A78BFA", dimSeparator: "#505050" },
    "Poimandres":         { primary: "#ADD7FF", planMode: "#A6ACCD", dimSeparator: "#506477" },
    "Moonlight":          { primary: "#82AAFF", planMode: "#C099FF", dimSeparator: "#5B5E7A" },
    "Vitesse Dark":       { primary: "#4FC1FF", planMode: "#C186E0", dimSeparator: "#555555" },
};

function ansiHex(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `\x1b[38;2;${r};${g};${b}m`;
}

function getThemeColors(): ThemeColors {
    try {
        const prefs = JSON.parse(readFileSync(join(homedir(), ".nightcode", "preferences.json"), "utf8"));
        const theme = THEMES[prefs.themeName];
        if (theme) return theme;
    } catch { /* no config */ }
    return THEMES["Nightfox"]!;
}

function draw(line: string, fg: string, sh: string, bg: string) {
    return line.split("").map(c =>
        c === "_" ? bg + " " + R :
        c === "^" ? fg + bg + "▀" + R :
        c === "~" ? sh + "▀" + R :
        c === " " ? " " :
        fg + c + R
    ).join("");
}

try {
    const raw = readFileSync(join(homedir(), ".nightcode", "last-session"), "utf8");
    const { id, title } = JSON.parse(raw);
    if (id && title) {
        const theme = getThemeColors();
        const dim = "\x1b[2m", bold = "\x1b[1m";
        const pad = (s: string) => s.padEnd(10, " ");
        const primary = ansiHex(theme.primary);
        const planMode = ansiHex(theme.planMode);
        const dimFg = ansiHex(theme.dimSeparator);

        process.stdout.write("\n");
        for (let row = 0; row < 4; row++) {
            const left  = ["N","I","G","H","T"].map(c => glyphs[c]![row]).join(" ");
            const right = ["C","O","D","E"].map(c => glyphs[c]![row]).join(" ");
            process.stdout.write(draw(left, primary, dimFg, "\x1b[48;5;235m") + "  " + draw(right, planMode, dimFg, "\x1b[48;5;238m") + "\n");
        }
        process.stdout.write("\n");
        process.stdout.write(` ${dim}${pad("Session")}${R}${bold}${title}${R}\n`);
        process.stdout.write(` ${dim}${pad("Continue")}${R}${bold}nightcode -s ${id}${R}\n`);
        process.stdout.write("\n");
    }
} catch { /* no last session */ }
