import { readFileSync } from "fs";

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
const lf = "\x1b[90m",  ls = "\x1b[38;5;235m", lb = "\x1b[48;5;235m";
const rf = "\x1b[0m",   rs = "\x1b[38;5;238m",  rb = "\x1b[48;5;238m";

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
    const { id, title } = JSON.parse(readFileSync("/tmp/nightcode-last-session.json", "utf8"));
    if (id) {
        const dim = "\x1b[2m", bold = "\x1b[1m";
        const pad = (s: string) => s.padEnd(10, " ");

        process.stdout.write("\n");
        for (let row = 0; row < 4; row++) {
            const left  = ["N","I","G","H","T"].map(c => glyphs[c]![row]).join(" ");
            const right = ["C","O","D","E"].map(c => glyphs[c]![row]).join(" ");
            process.stdout.write(draw(left, lf, ls, lb) + "  " + draw(right, rf, rs, rb) + "\n");
        }
        process.stdout.write("\n");
        process.stdout.write(` ${dim}${pad("Session")}${R}${bold}${title}${R}\n`);
        process.stdout.write(` ${dim}${pad("Continue")}${R}${bold}nightcode -s ${id}${R}\n`);
        process.stdout.write("\n");
    }
} catch { /* no last session */ }
