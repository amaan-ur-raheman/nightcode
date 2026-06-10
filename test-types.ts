import type { LanguageModelV3 } from "@ai-sdk/provider";

function wrap(model: LanguageModelV3): LanguageModelV3 {
    return {
        ...model,
        doGenerate: async (params: any) => model.doGenerate(params),
        doStream: async (params: any) => model.doStream(params),
    };
}
