import { type InferUITools, type LanguageModelUsage, type UIMessage } from 'ai';

import {
    type ModeType,
    type SupportedChatModelId,
    type ToolContracts,
    type ConversationBranch,
} from '@nightcode/shared';

export type ChatMessageMetadata = {
    mode?: ModeType;
    model?: SupportedChatModelId | string;
    durationMs?: number;
    usage?: LanguageModelUsage;
};

export type ChatTools = {
    [Name in keyof InferUITools<ToolContracts>]: {
        input: InferUITools<ToolContracts>[Name]['input'];
        output: unknown;
    };
};

export type Message = UIMessage<ChatMessageMetadata, any, ChatTools>;

export type ImageAttachment = {
    dataUrl: string;
    mimeType: string;
    name: string;
};

export type PendingToolCall = {
    toolName: string;
    input: unknown;
    toolCallId: string;
};
