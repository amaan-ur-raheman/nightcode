import React from "react";
import type { ThemeColors } from "@/theme";

type Token = {
    type: "keyword" | "string" | "number" | "comment" | "function" | "type" | "text";
    value: string;
};

const LANG_KEYWORDS: Record<string, string[]> = {
    js: [
        "const", "let", "var", "function", "return", "if", "else", "for",
        "while", "do", "switch", "case", "break", "continue", "new", "this",
        "class", "extends", "import", "from", "export", "default", "async",
        "await", "try", "catch", "finally", "throw", "typeof", "instanceof",
        "in", "of", "true", "false", "null", "undefined", "void", "delete",
        "yield", "static", "super", "with", "debugger",
    ],
    ts: [
        "const", "let", "var", "function", "return", "if", "else", "for",
        "while", "do", "switch", "case", "break", "continue", "new", "this",
        "class", "extends", "import", "from", "export", "default", "async",
        "await", "try", "catch", "finally", "throw", "typeof", "instanceof",
        "in", "of", "true", "false", "null", "undefined", "void", "delete",
        "yield", "static", "super", "with", "debugger", "type", "interface",
        "enum", "implements", "abstract", "readonly", "private", "protected",
        "public", "as", "is", "keyof", "infer", "never", "unknown", "any",
    ],
    python: [
        "def", "class", "return", "if", "elif", "else", "for", "while", "break",
        "continue", "import", "from", "as", "try", "except", "finally", "raise",
        "with", "yield", "lambda", "pass", "del", "global", "nonlocal", "assert",
        "True", "False", "None", "and", "or", "not", "in", "is", "self",
        "async", "await",
    ],
    go: [
        "func", "return", "if", "else", "for", "range", "switch", "case",
        "default", "break", "continue", "go", "chan", "select", "package",
        "import", "var", "const", "type", "struct", "interface", "map",
        "make", "new", "defer", "fallthrough", "goto", "true", "false", "nil",
    ],
    rust: [
        "fn", "let", "mut", "const", "return", "if", "else", "for", "while",
        "loop", "match", "break", "continue", "struct", "enum", "impl", "trait",
        "pub", "use", "mod", "crate", "self", "super", "as", "type", "where",
        "async", "await", "move", "ref", "true", "false", "Self",
    ],
    bash: [
        "if", "then", "else", "elif", "fi", "for", "while", "do", "done",
        "case", "esac", "function", "return", "exit", "local", "export",
        "source", "echo", "read", "test", "in",
    ],
    java: [
        "public", "private", "protected", "class", "interface", "enum",
        "extends", "implements", "new", "this", "super", "return", "if",
        "else", "for", "while", "do", "switch", "case", "break", "continue",
        "try", "catch", "finally", "throw", "throws", "void", "static",
        "final", "abstract", "synchronized", "volatile", "transient",
        "import", "package", "true", "false", "null", "instanceof",
    ],
    html: [
        "DOCTYPE", "html", "head", "body", "div", "span", "p", "a", "h1",
        "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "tr",
        "td", "th", "form", "input", "button", "select", "option", "textarea",
        "script", "style", "link", "meta", "title",
    ],
    css: [
        "color", "background", "margin", "padding", "border", "display",
        "position", "width", "height", "font", "text", "flex", "grid",
        "overflow", "z-index", "opacity", "transition", "animation",
        "transform", "none", "auto", "inherit", "initial", "important",
    ],
    json: [],
    sql: [
        "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE",
        "SET", "DELETE", "CREATE", "TABLE", "DROP", "ALTER", "INDEX",
        "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON", "AND", "OR",
        "NOT", "NULL", "IS", "IN", "LIKE", "BETWEEN", "EXISTS", "HAVING",
        "GROUP", "ORDER", "BY", "ASC", "DESC", "LIMIT", "OFFSET", "AS",
        "DISTINCT", "COUNT", "SUM", "AVG", "MIN", "MAX", "CASE", "WHEN",
        "THEN", "ELSE", "END", "UNION", "ALL", "PRIMARY", "KEY", "FOREIGN",
        "REFERENCES", "CONSTRAINT", "DEFAULT", "CHECK", "UNIQUE",
    ],
};

const TYPES: Record<string, string[]> = {
    ts: [
        "string", "number", "boolean", "any", "void", "never", "unknown",
        "object", "symbol", "bigint", "undefined", "null", "Array", "Promise",
        "Record", "Partial", "Required", "Pick", "Omit", "Exclude",
        "Extract", "ReturnType", "InstanceType",
    ],
    tsx: [
        "string", "number", "boolean", "any", "void", "never", "unknown",
        "object", "symbol", "bigint", "undefined", "null", "Array", "Promise",
        "Record", "Partial", "Required", "Pick", "Omit", "Exclude",
        "Extract", "ReturnType", "InstanceType",
    ],
    rust: [
        "i8", "i16", "i32", "i64", "i128", "u8", "u16", "u32", "u64", "u128",
        "f32", "f64", "bool", "char", "str", "String", "Vec", "Option",
        "Result", "Box", "Rc", "Arc", "HashMap", "HashSet", "usize", "isize",
    ],
    go: [
        "int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16",
        "uint32", "uint64", "float32", "float64", "complex64", "complex128",
        "bool", "byte", "rune", "string", "error",
    ],
    java: [
        "int", "long", "double", "float", "boolean", "char", "byte", "short",
        "String", "Integer", "Long", "Double", "Float", "Boolean", "Character",
        "Object", "List", "Map", "Set", "ArrayList", "HashMap", "LinkedList",
    ],
};

const LANG_EXTENSIONS: Record<string, string> = {
    js: "js", jsx: "js", mjs: "js", cjs: "js",
    ts: "ts", tsx: "ts",
    py: "python", pyw: "python",
    go: "go",
    rs: "rust",
    rb: "ruby",
    sh: "bash", bash: "bash", zsh: "bash",
    java: "java",
    html: "html", htm: "html",
    css: "css", scss: "css", less: "css",
    json: "json", jsonc: "json",
    sql: "sql",
    c: "c", cpp: "c", cxx: "c", cc: "c", h: "c", hpp: "c",
    cs: "csharp",
    php: "php",
    swift: "swift",
    kt: "kotlin", kts: "kotlin",
    xml: "html", yaml: "json", yml: "json",
};

const COMMENT_PATTERNS: Record<string, string[]> = {
    js: ["//", "/*"],
    ts: ["//", "/*"],
    python: ["#"],
    go: ["//", "/*"],
    rust: ["//", "/*"],
    bash: ["#"],
    java: ["//", "/*"],
    html: ["<!--"],
    css: ["/*"],
    c: ["//", "/*"],
    csharp: ["//", "/*"],
    php: ["//", "#", "/*"],
    swift: ["//", "/*"],
    kotlin: ["//", "/*"],
};

const STRING_CHARS = ['"', "'", "`"];

const BUILTIN_FUNCS: Record<string, Set<string>> = {
    js: new Set([
        "console", "log", "error", "warn", "info", "dir", "time", "timeEnd",
        "setTimeout", "setInterval", "clearTimeout", "clearInterval",
        "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURI",
        "decodeURI", "encodeURIComponent", "decodeURIComponent", "fetch",
        "require", "module", "exports", "process", "Buffer", "Promise",
        "Array", "Object", "String", "Number", "Boolean", "Symbol", "Map",
        "Set", "WeakMap", "WeakSet", "Date", "RegExp", "Error", "Math",
        "JSON", "URL", "URLSearchParams", "FormData", "Headers", "Request",
        "Response", "AbortController", "AbortSignal", "EventTarget",
        "addEventListener", "removeEventListener", "dispatchEvent",
        "querySelector", "querySelectorAll", "getElementById",
        "getElementsByClassName", "getElementsByTagName", "createElement",
        "createTextNode", "appendChild", "removeChild", "insertBefore",
        "replaceChild", "cloneNode", "hasChildNodes", "normalize",
        "isEqualNode", "isSameNode", "compareDocumentPosition",
        "contains", "getRootNode", "closest", "matches", "scrollIntoView",
        "scroll", "scrollTo", "scrollBy", "getBoundingClientRect",
        "getClientRects", "focus", "blur", "click", "select", "setSelectionRange",
        "checkValidity", "reportValidity", "submit", "reset", "requestSubmit",
        "requestFullscreen", "exitFullscreen", "fullscreenElement",
        "fullscreenEnabled", "requestPointerLock", "exitPointerLock",
        "pointerLockElement",
    ]),
    python: new Set([
        "print", "len", "range", "type", "int", "float", "str", "bool",
        "list", "dict", "tuple", "set", "None", "True", "False", "isinstance",
        "issubclass", "hasattr", "getattr", "setattr", "delattr", "property",
        "staticmethod", "classmethod", "super", "repr", "id", "hash",
        "callable", "iter", "next", "sorted", "reversed", "enumerate",
        "zip", "map", "filter", "reduce", "sum", "min", "max", "abs",
        "round", "pow", "divmod", "input", "open", "file", "exec", "eval",
        "compile", "globals", "locals", "vars", "dir", "help", "exit",
        "quit", "copyright", "credits", "license",
    ]),
    go: new Set([
        "fmt", "Println", "Printf", "Print", "Sprintf", "Sprintln", "Sprint",
        "Fprintf", "Fprintln", "Fprint", "Errorf", "errors", "New", "Is",
        "As", "Unwrap", "math", "Rand", "Max", "Min", "Abs", "Ceil", "Floor",
        "Round", "Sqrt", "Pow", "Log", "Log2", "Log10", "Exp", "Pi", "E",
        "strings", "Contains", "HasPrefix", "HasSuffix", "Index", "Split",
        "Join", "Replace", "ToLower", "ToUpper", "Trim", "TrimSpace",
        "Repeat", "Count", "Map", "Reader", "Read", "Write", "Close",
        "io", "Copy", "ReadFull", "ReadAtLeast", "WriteString", "LimitedReader",
        "TeeReader", "MultiReader", "MultiWriter", "Pipe", "os", "Stdin",
        "Stdout", "Stderr", "Open", "Create", "Remove", "RemoveAll", "Rename",
        "Mkdir", "MkdirAll", "Stat", "Lstat", "Chmod", "Chown", "Chtimes",
        "ReadFile", "WriteFile", "ReadDir", "Getwd", "Chdir", "TempDir",
        "MkdirTemp", "CreateTemp", "NewFile", "NewScanner", "NewReader",
        "NewWriter", "Symlink", "Link", "Readlink",
    ]),
    rust: new Set([
        "println", "print", "eprintln", "eprint", "format", "vec", "String",
        "from", "to_string", "as_str", "push", "push_str", "pop", "len",
        "is_empty", "contains", "starts_with", "ends_with", "find", "rfind",
        "replace", "split", "trim", "trim_start", "trim_end", "lines",
        "chars", "bytes", "collect", "iter", "into_iter", "map", "filter",
        "fold", "reduce", "any", "all", "take", "skip", "chain", "zip",
        "enumerate", "flat_map", "flatten", "peekable", "fuse", "inspect",
        "Option", "Some", "None", "Ok", "Err", "Result", "unwrap",
        "unwrap_or", "unwrap_or_else", "unwrap_or_default", "expect",
        "map", "and_then", "or_else", "is_some", "is_none", "is_ok",
        "is_err", "match", "if let", "while let",
    ]),
    bash: new Set([
        "echo", "printf", "read", "test", "[", "[[", "expr", "let",
        "declare", "local", "export", "typeset", "readonly", "unset",
        "shift", "source", "eval", "exec", "exit", "return", "trap",
        "wait", "kill", "sleep", "date", "time", "cal", "which", "type",
        "hash", "builtin", "command", "enable", "help", "history",
        "fc", "jobs", "bg", "fg", "disown", "suspend", "logout", "login",
        "cd", "pwd", "pushd", "popd", "dirs", "mkdir", "rmdir", "touch",
        "cp", "mv", "rm", "ln", "chmod", "chown", "chgrp", "ls", "dir",
        "vdir", "cat", "tac", "more", "less", "head", "tail", "cut",
        "paste", "join", "tr", "sed", "awk", "grep", "egrep", "fgrep",
        "find", "xargs", "df", "du", "stat", "touch", "file",
    ]),
    java: new Set([
        "System", "out", "println", "print", "printf", "String", "Integer",
        "Long", "Double", "Float", "Boolean", "Character", "Object", "Class",
        "Thread", "Runnable", "Exception", "Error", "Throwable", "List",
        "ArrayList", "LinkedList", "Map", "HashMap", "TreeMap", "Set",
        "HashSet", "TreeSet", "Queue", "Deque", "ArrayDeque",
        "Collections", "Arrays", "Objects", "Math", "Random", "UUID",
        "Scanner", "BufferedReader", "FileReader", "FileWriter",
        "InputStream", "OutputStream", "FileInputStream", "FileOutputStream",
        "File", "Path", "Paths", "Files", "IOException", "FileNotFoundException",
    ]),
};

const COMMENT_START_JS = ["//", "/*"];
const COMMENT_START_PYTHON = ["#"];
const COMMENT_START_HTML = ["<!--"];

function detectLanguage(code: string, langHint?: string): string {
    if (langHint && LANG_KEYWORDS[langHint]) return langHint;
    if (langHint && LANG_EXTENSIONS[langHint]) return LANG_EXTENSIONS[langHint];

    const trimmed = code.trimStart();
    if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) return "html";
    if (trimmed.startsWith("<?xml")) return "html";
    if (trimmed.match(/^\{[\s\S]*"[\w]+":/)) return "json";
    if (trimmed.match(/^SELECT\s/i)) return "sql";
    if (trimmed.match(/^package\s+\w+/)) return "go";
    if (trimmed.match(/^#include/)) return "c";
    if (trimmed.match(/^using\s+\w+/)) return "csharp";
    if (trimmed.match(/^import\s+.*from\s+['"]/)) return "js";
    if (trimmed.match(/^(const|let|var)\s+\w+\s*=/)) return "js";
    if (trimmed.match(/^(async\s+)?function/)) return "js";
    if (trimmed.match(/^def\s+\w+/)) return "python";
    if (trimmed.match(/^(class|struct)\s+\w+/)) return "rust";
    if (trimmed.match(/^(fn|pub\s+fn|pub\(crate\)\s+fn)/)) return "rust";
    if (trimmed.match(/func\s+\w+/)) return "go";
    if (trimmed.match(/(public|private|protected)\s+(static\s+)?(class|void|int)/)) return "java";

    return "js";
}

function getCommentStart(lang: string): string[] | null {
    if (lang === "js" || lang === "ts" || lang === "c" || lang === "csharp" ||
        lang === "swift" || lang === "kotlin" || lang === "java" || lang === "go" ||
        lang === "rust") {
        return ["//", "/*"];
    }
    if (lang === "python") return ["#"];
    if (lang === "html") return ["<!--"];
    if (lang === "css") return ["/*"];
    if (lang === "bash") return ["#"];
    if (lang === "php") return ["//", "#", "/*"];
    return null;
}

function tokenize(code: string, lang: string): Token[] {
    const tokens: Token[] = [];
    const keywords = new Set(LANG_KEYWORDS[lang] ?? []);
    const types = new Set(TYPES[lang] ?? []);
    const builtins = BUILTIN_FUNCS[lang] ?? new Set();
    const commentStart = getCommentStart(lang);

    let i = 0;
    while (i < code.length) {
        // Check for comments
        if (commentStart) {
            if (commentStart[1] && code.startsWith(commentStart[1], i)) {
                const endIdx = code.indexOf(commentStart[1] === "/*" ? "*/" : "-->", i + commentStart[1].length);
                const end = endIdx !== -1 ? endIdx + (commentStart[1] === "/*" ? 2 : 3) : code.length;
                tokens.push({ type: "comment", value: code.slice(i, end) });
                i = end;
                continue;
            } else if (commentStart[0] && code.startsWith(commentStart[0], i)) {
                const end = code.indexOf("\n", i);
                const lineEnd = end !== -1 ? end : code.length;
                tokens.push({ type: "comment", value: code.slice(i, lineEnd) });
                i = lineEnd;
                continue;
            }
        }

        // Check for strings
        if (STRING_CHARS.includes(code[i]!)) {
            const quote = code[i]!;
            let j = i + 1;
            while (j < code.length && code[j] !== quote) {
                if (code[j] === "\\") {
                    if (j + 1 < code.length) {
                        j += 2;
                    } else {
                        j++;
                        break;
                    }
                } else {
                    j++;
                }
            }
            j = Math.min(j + 1, code.length);
            tokens.push({ type: "string", value: code.slice(i, j) });
            i = j;
            continue;
        }

        // Check for numbers
        if (/[0-9]/.test(code[i]!) && (i === 0 || /[\s(,;=[\]{}!&|<>+\-*/^%~]/.test(code[i - 1]!))) {
            let j = i;
            while (j < code.length && /[0-9._xXeEabcdefABCDEF]/.test(code[j]!)) j++;
            tokens.push({ type: "number", value: code.slice(i, j) });
            i = j;
            continue;
        }

        // Check for words (identifiers/keywords)
        if (/[a-zA-Z_$]/.test(code[i]!)) {
            let j = i;
            while (j < code.length && /[a-zA-Z0-9_$]/.test(code[j]!)) j++;
            const word = code.slice(i, j);

            if (keywords.has(word)) {
                tokens.push({ type: "keyword", value: word });
            } else if (types.has(word)) {
                tokens.push({ type: "type", value: word });
            } else if (builtins.has(word)) {
                tokens.push({ type: "function", value: word });
            } else if (j < code.length && code[j] === "(") {
                tokens.push({ type: "function", value: word });
            } else {
                tokens.push({ type: "text", value: word });
            }
            i = j;
            continue;
        }

        tokens.push({ type: "text", value: code[i]! });
        i++;
    }

    return tokens;
}

function getTokenColor(tokenType: Token["type"], colors: ThemeColors): string {
    switch (tokenType) {
        case "keyword": return colors.primary;
        case "string": return colors.success;
        case "number": return colors.primary;
        case "comment": return colors.dimSeparator;
        case "function": return colors.info;
        case "type": return colors.planMode;
        case "text": return colors.text;
        default: return colors.text;
    }
}

function getTokenAttributes(tokenType: Token["type"]): number {
    switch (tokenType) {
        case "keyword": return 1;
        case "comment": return 2;
        case "type": return 2;
        default: return 0;
    }
}

const LANG_LABELS: Record<string, string> = {
    js: "JavaScript",
    ts: "TypeScript",
    python: "Python",
    go: "Go",
    rust: "Rust",
    bash: "Bash",
    java: "Java",
    html: "HTML",
    css: "CSS",
    json: "JSON",
    sql: "SQL",
    c: "C",
    csharp: "C#",
    php: "PHP",
    swift: "Swift",
    kotlin: "Kotlin",
};

function highlightCode(code: string, langHint?: string, colors?: ThemeColors): React.ReactElement {
    if (!colors) {
        return React.createElement("text", null, code);
    }

    const lang = detectLanguage(code, langHint);
    const tokens = tokenize(code, lang);
    const label = LANG_LABELS[lang] ?? lang.toUpperCase();

    return React.createElement(
        React.Fragment,
        null,
        React.createElement(
            "text",
            { attributes: 2, fg: colors.dimSeparator },
            `--- ${label} ---`
        ),
        React.createElement(
            "text",
            null,
            tokens.map((token, i) =>
                React.createElement(
                    "text",
                    {
                        key: i,
                        fg: getTokenColor(token.type, colors),
                        attributes: getTokenAttributes(token.type),
                    },
                    token.value
                )
            )
        )
    );
}

export { highlightCode, detectLanguage, LANG_LABELS };
