/* global module */
/**
 * ESLint rule to prevent <text> nested inside <text>.
 * In Ink/React Native for terminals, <text> elements must not be nested.
 */

module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow <text> elements nested inside other <text> elements',
            recommended: true,
        },
        messages: {
            noTextInText:
                'Unexpected <text> nested inside another <text>. Use a single <text> with multiple children or separate <text> elements.',
        },
        schema: [],
    },
    create(context) {
        return {
            JSXElement(node) {
                const openingElement = node.openingElement;
                const tagName =
                    openingElement.name &&
                    openingElement.name.type === 'JSXIdentifier'
                        ? openingElement.name.name
                        : null;

                // Check if this is a <text> element
                if (tagName !== 'text') return;

                // Walk up the AST to find parent <text> elements
                let parent = node.parent;
                while (parent) {
                    if (
                        parent.type === 'JSXElement' &&
                        parent.openingElement &&
                        parent.openingElement.name &&
                        parent.openingElement.name.type === 'JSXIdentifier' &&
                        parent.openingElement.name.name === 'text'
                    ) {
                        context.report({
                            node: openingElement,
                            messageId: 'noTextInText',
                        });
                        return; // Only report once per nesting
                    }
                    parent = parent.parent;
                }
            },
        };
    },
};
