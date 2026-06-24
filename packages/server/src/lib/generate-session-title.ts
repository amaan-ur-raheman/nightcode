import { generateText } from 'ai';
import { createGroq } from '@ai-sdk/groq';

function fallbackTitle(userMessage: string): string {
    return userMessage.slice(0, 80).trimEnd();
}

export async function generateSessionTitle(
    userMessage: string,
    model?: any,
): Promise<string> {
    let activeModel = model;
    if (!activeModel) {
        if (!process.env.GROQ_API_KEY) return fallbackTitle(userMessage);
        try {
            const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
            activeModel = groq('llama-3.1-8b-instant');
        } catch {
            return fallbackTitle(userMessage);
        }
    }

    try {
        const { text } = await generateText({
            model: activeModel,
            prompt: `Generate a short, descriptive title (max 60 characters) for a coding session that starts with this message. Reply with only the title, no quotes or punctuation at the end.\n\nMessage: ${userMessage.slice(0, 500)}`,
            maxTokens: 30,
        } as any);

        return text.trim().slice(0, 80) || fallbackTitle(userMessage);
    } catch {
        return fallbackTitle(userMessage);
    }
}
