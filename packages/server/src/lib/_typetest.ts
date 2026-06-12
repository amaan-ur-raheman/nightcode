import type { LanguageModel } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';

function wrap(model: LanguageModelV3): LanguageModel {
    return {
        ...model,
        doGenerate: (params: any): Promise<any> =>
            Promise.resolve(model.doGenerate(params)),
        doStream: (params: any): Promise<any> =>
            Promise.resolve(model.doStream(params)),
    };
}
