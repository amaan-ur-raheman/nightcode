import { toolInputSchemas } from '@nightcode/shared';
import {
    orchestratorTool,
    getTaskStatusTool,
    cancelTaskTool,
} from './orchestrator';
import { taskListTool } from './task-list';
import { declareConfidenceTool } from './declare-confidence';

export async function orchestrateTaskTool(
    input: unknown,
    parentMode?: any,
    parentModel?: string,
    signal?: AbortSignal,
    execId?: string,
) {
    const parsed = toolInputSchemas.orchestrate_task.parse(input);
    const { action } = parsed;

    if (action === 'orchestrate') {
        return await orchestratorTool(
            parsed,
            parentMode,
            parentModel,
            signal,
            execId,
        );
    }

    if (action === 'status') {
        return await getTaskStatusTool(parsed);
    }

    if (action === 'cancel') {
        return await cancelTaskTool(parsed);
    }

    if (action.startsWith('checklist_')) {
        const checklistAction = action.replace('checklist_', '');
        const { checklistTasks, taskId, checklistStatus } = parsed;
        const taskListInput = {
            action: checklistAction,
            tasks: checklistTasks,
            taskId,
            status: checklistStatus,
        };
        return await taskListTool(
            taskListInput,
            parentMode,
            parentModel,
            signal,
            execId,
        );
    }

    if (action === 'declare_confidence') {
        const { confidence, reasoning, suggestedApproach } = parsed;
        if (!confidence || !reasoning) {
            throw new Error(
                'confidence and reasoning are required for declare_confidence action',
            );
        }
        return await declareConfidenceTool({
            confidence,
            reasoning,
            suggestedApproach,
        });
    }

    throw new Error(`Unknown action: ${action}`);
}
