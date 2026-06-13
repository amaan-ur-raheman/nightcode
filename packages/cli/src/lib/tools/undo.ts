import { undoManager } from '../undo-manager';
import { correctionTracker } from '../correction-tracker';

export async function undoTool(_input: unknown) {
    // Learn from the correction before restoring
    const correction = await correctionTracker.onUndo();

    const result = await undoManager.undoLast();
    if (!result) return { output: 'Nothing to undo' };

    const parts = [
        `Undid changes to ${result.filePath} (${result.restored ? 'success' : 'failed'})`,
    ];
    if (correction) {
        parts.push(`
Learned correction: ${correction}`);
    }
    return { output: parts.join('') };
}
