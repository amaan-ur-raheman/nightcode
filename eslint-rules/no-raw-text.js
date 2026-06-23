/* global module */
/**
 * ESLint rule to prevent raw text outside of <text> elements.
 * In Ink/OpenTUI, text elements must always be enclosed in <text> (or its inline tags).
 */

const ALLOWED_TEXT_CONTAINERS = new Set([
    'text',
    'span',
    'a',
    'em',
    'strong',
    'b',
    'i',
]);

module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow raw text nodes outside of `<text>` and inline styling tags',
            recommended: true,
        },
        messages: {
            noRawText:
                'Unexpected raw text "{{text}}" outside of a <text> element. Wrap text inside a <text> element.',
        },
        schema: [],
    },
    create(context) {
        function checkParent(node, textValue) {
            let parent = node.parent;
            // Walk past fragments
            while (parent && parent.type === 'JSXFragment') {
                parent = parent.parent;
            }

            if (parent && parent.type === 'JSXElement') {
                const openingElement = parent.openingElement;
                const tagName =
                    openingElement.name &&
                    openingElement.name.type === 'JSXIdentifier'
                        ? openingElement.name.name
                        : null;

                if (tagName && !ALLOWED_TEXT_CONTAINERS.has(tagName)) {
                    context.report({
                        node,
                        messageId: 'noRawText',
                        data: {
                            text:
                                textValue.trim().slice(0, 15) +
                                (textValue.trim().length > 15 ? '...' : ''),
                        },
                    });
                }
            }
        }

        return {
            JSXText(node) {
                const value = node.value || '';
                if (value.trim() === '') return; // ignore whitespace-only nodes
                checkParent(node, value);
            },
            JSXExpressionContainer(node) {
                if (
                    node.parent &&
                    (node.parent.type === 'JSXElement' ||
                        node.parent.type === 'JSXFragment')
                ) {
                    const expr = node.expression;
                    if (!expr) return;

                    // Catch explicit string literals or template literals outside text containers
                    if (
                        expr.type === 'Literal' &&
                        typeof expr.value === 'string' &&
                        expr.value.trim() !== ''
                    ) {
                        checkParent(node, expr.value);
                    } else if (expr.type === 'TemplateLiteral') {
                        checkParent(node, 'template literal');
                    }
                }
            },
        };
    },
};
