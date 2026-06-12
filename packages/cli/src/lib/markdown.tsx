import { useMemo, useRef } from 'react';
import { SyntaxStyle, TextAttributes } from '@opentui/core';
import { useTheme } from '@/providers/theme';

type MarkdownTextProps = {
    children: string;
    streaming?: boolean;
    attributes?: number;
    fg?: string;
};

function getStableContent(content: string, streaming: boolean): string {
    if (!streaming) return content;

    const lines = content.split('\n');
    const isSeparator = (l: string) =>
        /^\|?[\s\-:|]+\|/.test(l.trimStart()) && /\-/.test(l);
    const isTableRow = (l: string) => /^\s*\|/.test(l) || isSeparator(l);

    // Find the start of the last contiguous block of table lines
    let tableStart = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (isTableRow(lines[i]!)) {
            tableStart = i;
        } else if (tableStart !== -1) {
            break;
        }
    }

    if (tableStart !== -1) {
        const tableLines = lines.slice(tableStart);
        const sepIndex = tableLines.findIndex(isSeparator);
        // Need: separator exists AND at least one data row after it
        const isComplete =
            sepIndex !== -1 &&
            tableLines.slice(sepIndex + 1).some((l) => /^\s*\|/.test(l));
        if (!isComplete) {
            return lines.slice(0, tableStart).join('\n');
        }
    }

    return content;
}

export function MarkdownText({
    children,
    streaming = false,
    attributes,
    fg,
}: MarkdownTextProps) {
    const { colors } = useTheme();
    const renderKey = useRef(0);
    const wasStreaming = useRef(false);
    if (wasStreaming.current && !streaming) renderKey.current++;
    wasStreaming.current = streaming;

    const syntaxStyle = useMemo(
        () =>
            SyntaxStyle.fromStyles({
                // Code syntax
                keyword: { fg: colors.planMode, bold: true },
                string: { fg: colors.success },
                number: { fg: colors.primary },
                comment: { fg: colors.dimSeparator, italic: true },
                function: { fg: colors.info },
                type: { fg: colors.primary, italic: true },
                variable: { fg: colors.error },
                operator: { fg: colors.dimSeparator },
                punctuation: { fg: colors.dimSeparator },
                constant: { fg: colors.primary },
                property: { fg: colors.info },
                tag: { fg: colors.error },
                attribute: { fg: colors.success },
                // Markdown inline
                'markup.strong': { bold: true },
                'markup.italic': { italic: true },
                'markup.strikethrough': { dim: true },
                'markup.heading': { fg: colors.primary, bold: true },
                'markup.raw': { fg: colors.info },
                'markup.raw.block': { fg: colors.info },
                'markup.link': { fg: colors.info, underline: true },
                'markup.link.label': { fg: colors.info, underline: true },
                'markup.link.url': { fg: colors.dimSeparator },
                'markup.list': { fg: colors.primary },
                'markup.quote': { fg: colors.dimSeparator, italic: true },
            }),
        [colors],
    );

    return (
        <markdown
            key={renderKey.current}
            content={getStableContent(children, streaming)}
            syntaxStyle={syntaxStyle}
            streaming={streaming}
            conceal={true}
            concealCode={true}
            fg={fg}
            tableOptions={{
                style: 'grid',
                widthMode: 'full',
                wrapMode: 'word',
                cellPaddingX: 1,
                borderColor: colors.dimSeparator,
            }}
        />
    );
}
