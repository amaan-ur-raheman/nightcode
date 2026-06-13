import { toolInputSchemas } from '@nightcode/shared';
import { replRunner } from '../repl-runner';

export async function replExecuteTool(input: unknown) {
    const { command } = toolInputSchemas.replExecute.parse(input);
    const output = await replRunner.execute(command);
    return {
        output,
    };
}
