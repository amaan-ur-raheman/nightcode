const js = require('@eslint/js');
const ts = require('typescript-eslint');
const react = require('eslint-plugin-react');
const prettier = require('eslint-config-prettier');
const noTextInText = require('./eslint-rules/no-text-in-text');

module.exports = [
    {
        ignores: [
            'node_modules/**',
            'dist/**',
            'build/**',
            '**/*.log',
            'coverage/**',
            'packages/cli/bin/**',
            'packages/**/dist/**',
            'eslint.config.js',
        ],
    },
    js.configs.recommended,
    ...ts.configs.recommended,
    {
        files: ['**/*.ts', '**/*.tsx'],
        plugins: {
            react,
            'no-text-in-text': {
                rules: {
                    'no-text-in-text': noTextInText,
                },
            },
        },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        settings: {
            react: {
                version: 'detect',
            },
        },
        rules: {
            'react/react-in-jsx-scope': 'off',
            '@typescript-eslint/no-unused-vars': 'warn',
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-require-imports': 'warn',
            'no-empty': 'warn',
            'no-useless-escape': 'warn',
            'no-useless-assignment': 'warn',
            '@typescript-eslint/no-unsafe-function-type': 'warn',
            'no-case-declarations': 'warn',
            'no-control-regex': 'warn',
            'preserve-caught-error': 'off',
            'no-text-in-text/no-text-in-text': 'error',
        },
    },
    prettier,
];
