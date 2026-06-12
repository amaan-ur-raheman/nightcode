import { debug } from './debug';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

export interface ServerHealth {
    name: string;
    connected: boolean;
    lastCheck: Date;
    lastError?: string;
    reconnectAttempts: number;
}

type ReconnectFn = () => Promise<Client>;

class MCPHealthManager {
    private health: Map<string, ServerHealth> = new Map();
    private clients: Map<string, Client> = new Map();
    private reconnectFns: Map<string, ReconnectFn> = new Map();
    private checkInterval = 30_000;
    private maxReconnectAttempts = 3;
    private checkTimer?: ReturnType<typeof setInterval>;
    private reconnecting: Set<string> = new Set();

    register(name: string, client: Client, reconnectFn: ReconnectFn): void {
        this.clients.set(name, client);
        this.reconnectFns.set(name, reconnectFn);
        this.health.set(name, {
            name,
            connected: true,
            lastCheck: new Date(),
            reconnectAttempts: 0,
        });
    }

    unregister(name: string): void {
        this.clients.delete(name);
        this.reconnectFns.delete(name);
        this.health.delete(name);
    }

    startMonitoring(): void {
        if (this.checkTimer) return;
        debug.log('mcp', 'Starting health monitoring', {
            intervalMs: this.checkInterval,
        });
        this.checkTimer = setInterval(() => {
            void this.checkAllServers();
        }, this.checkInterval);
    }

    stopMonitoring(): void {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = undefined;
            debug.log('mcp', 'Stopped health monitoring');
        }
    }

    async checkServer(name: string): Promise<boolean> {
        const client = this.clients.get(name);
        if (!client) {
            this.health.set(name, {
                name,
                connected: false,
                lastCheck: new Date(),
                lastError: 'No client registered',
                reconnectAttempts:
                    this.health.get(name)?.reconnectAttempts ?? 0,
            });
            return false;
        }

        try {
            await client.listTools();
            this.health.set(name, {
                name,
                connected: true,
                lastCheck: new Date(),
                reconnectAttempts: 0,
            });
            return true;
        } catch (error) {
            const prev = this.health.get(name);
            const errMsg =
                error instanceof Error ? error.message : String(error);
            this.health.set(name, {
                name,
                connected: false,
                lastCheck: new Date(),
                lastError: errMsg,
                reconnectAttempts: prev?.reconnectAttempts ?? 0,
            });
            debug.warn('mcp', `Health check failed for ${name}: ${errMsg}`);
            return false;
        }
    }

    async reconnect(name: string): Promise<boolean> {
        const health = this.health.get(name);
        if (health && health.reconnectAttempts >= this.maxReconnectAttempts) {
            debug.error('mcp', `Max reconnect attempts reached for ${name}`);
            return false;
        }

        const reconnectFn = this.reconnectFns.get(name);
        if (!reconnectFn) {
            debug.error('mcp', `No reconnect function registered for ${name}`);
            return false;
        }

        try {
            const client = await reconnectFn();
            this.clients.set(name, client);
            this.health.set(name, {
                name,
                connected: true,
                lastCheck: new Date(),
                reconnectAttempts: 0,
            });
            debug.log('mcp', `Reconnected to ${name} successfully`);
            return true;
        } catch (error) {
            const errMsg =
                error instanceof Error ? error.message : String(error);
            const prev = this.health.get(name);
            this.health.set(name, {
                name,
                connected: false,
                lastCheck: new Date(),
                lastError: errMsg,
                reconnectAttempts: (prev?.reconnectAttempts ?? 0) + 1,
            });
            debug.error(
                'mcp',
                `Reconnect failed for ${name}`,
                error instanceof Error ? error : undefined,
            );
            return false;
        } finally {
            this.reconnecting.delete(name);
        }
    }

    async checkAllServers(): Promise<void> {
        const names = Array.from(this.clients.keys());
        const results = await Promise.allSettled(
            names.map(async (name) => {
                const healthy = await this.checkServer(name);
                if (!healthy) {
                    if (this.reconnecting.has(name)) {
                        debug.log(
                            'mcp',
                            `Reconnect already in progress for ${name}, skipping duplicate attempt`,
                        );
                        return;
                    }
                    debug.log('mcp', `Attempting auto-reconnect for ${name}`);
                    this.reconnecting.add(name);
                    await this.reconnect(name);
                }
            }),
        );
        for (const result of results) {
            if (result.status === 'rejected') {
                debug.warn(
                    'mcp',
                    `Unexpected error during health check: ${String(result.reason)}`,
                );
            }
        }
    }

    getHealth(name: string): ServerHealth | undefined {
        return this.health.get(name);
    }

    getAllHealth(): ServerHealth[] {
        return Array.from(this.health.values());
    }

    isHealthy(name: string): boolean {
        return this.health.get(name)?.connected ?? false;
    }
}

export const mcpHealth = new MCPHealthManager();
