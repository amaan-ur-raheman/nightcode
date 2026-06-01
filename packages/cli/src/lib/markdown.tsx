import { useMemo } from "react";
import { SyntaxStyle } from "@opentui/core";
import { useTheme } from "@/providers/theme";

type MarkdownTextProps = {
    children: string;
    streaming?: boolean;
};

export function MarkdownText({ children, streaming = false }: MarkdownTextProps) {
    const { colors } = useTheme();

    const syntaxStyle = useMemo(() => SyntaxStyle.fromStyles({
        keyword:             { fg: colors.planMode, bold: true },
        string:              { fg: colors.success },
        number:              { fg: colors.primary },
        comment:             { fg: colors.dimSeparator, italic: true },
        function:            { fg: colors.info },
        type:                { fg: colors.primary, italic: true },
        variable:            { fg: colors.error },
        operator:            { fg: colors.dimSeparator },
        punctuation:         { fg: colors.dimSeparator },
        constant:            { fg: colors.primary },
        property:            { fg: colors.info },
        tag:                 { fg: colors.error },
        attribute:           { fg: colors.success },
        "markup.bold":       { bold: true },
        "markup.italic":     { italic: true },
        "markup.heading":    { fg: colors.primary, bold: true },
        "markup.inline.raw": { fg: colors.info },
        "markup.link":       { fg: colors.info, underline: true },
        "markup.quote":      { fg: colors.dimSeparator, italic: true },
    }), [colors]);

    return (
        <markdown
            content={children}
            syntaxStyle={syntaxStyle}
            streaming={streaming}
            conceal={true}
        />
    );
}
