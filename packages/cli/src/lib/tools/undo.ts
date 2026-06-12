import { undoManager } from '../undo-manager';

export async function undoTool(_input: unknown) {
    const result = await undoManager.undoLast();
    if (!result) return { output: 'Nothing to undo' };
    return {
        output: `Undid changes to ${result.filePath} (${result.restored ? 'success' : 'failed'})`,
    };
}
