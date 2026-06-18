export const EmptyBorder = {
    topLeft: '',
    bottomLeft: '',
    vertical: '',
    topRight: '',
    bottomRight: '',
    horizontal: ' ',
    bottomT: '',
    topT: '',
    cross: '',
    leftT: '',
    rightT: '',
};

export const MessageBorder = {
    ...EmptyBorder,
    vertical: '┃',
    bottomLeft: '╹',
};

export const ToolBorder = {
    ...EmptyBorder,
    vertical: '│',
};

export const PanelBorder = {
    ...EmptyBorder,
    horizontal: '─',
};

export const SplitBorderChars = {
    ...EmptyBorder,
    vertical: '┃',
};
