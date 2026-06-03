import { useMemo } from "react";
import { SyntaxStyle, TextAttributes } from "@opentui/core";
import { useTheme } from "@/providers/theme";

type MarkdownTextProps = {
    children: string;
    streaming?: boolean;
    attributes?: number;
    fg?: string;
};

export function MarkdownText({ children, streaming = false, attributes, fg }: MarkdownTextProps) {
    const { colors } = useTheme();

    const syntaxStyle = useMemo(() => SyntaxStyle.fromStyles({
        // Code syntax
        keyword:              { fg: colors.planMode, bold: true },
        string:               { fg: colors.success },
        number:               { fg: colors.primary },
        comment:              { fg: colors.dimSeparator, italic: true },
        function:             { fg: colors.info },
        type:                 { fg: colors.primary, italic: true },
        variable:             { fg: colors.error },
        operator:             { fg: colors.dimSeparator },
        punctuation:          { fg: colors.dimSeparator },
        constant:             { fg: colors.primary },
        property:             { fg: colors.info },
        tag:                  { fg: colors.error },
        attribute:            { fg: colors.success },
        // Markdown inline
        "markup.strong":         { bold: true },
        "markup.italic":         { italic: true },
        "markup.strikethrough":  { dim: true },
        "markup.heading":        { fg: colors.primary, bold: true },
        "markup.raw":            { fg: colors.info },
        "markup.raw.block":      { fg: colors.info },
        "markup.link":           { fg: colors.info, underline: true },
        "markup.link.label":     { fg: colors.info, underline: true },
        "markup.link.url":       { fg: colors.dimSeparator },
        "markup.list":           { fg: colors.primary },
        "markup.quote":          { fg: colors.dimSeparator, italic: true },
    }), [colors]);

    return (
        <markdown
            content={children}
            syntaxStyle={syntaxStyle}
            streaming={streaming}
            conceal={true}
            concealCode={true}
            fg={fg}
        />
    );
}
