import { toolInputSchemas } from '@nightcode/shared';
import { questionManager } from './question-manager';

export async function askQuestionTool(input: unknown) {
    const { questions } = toolInputSchemas.askQuestion.parse(input);
    const answers = await questionManager.request(questions);
    return { answers };
}
