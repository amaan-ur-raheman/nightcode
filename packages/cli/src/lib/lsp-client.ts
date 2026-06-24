import { spawn } from 'child_process';
import { resolve } from 'path';

interface LspResponse {
    jsonrpc: string;
    id?: number;
    result?: any;
    error?: any;
    method?: string;
    params?: any;
}

export class LspClient {
    private process: any = null;
    private buffer: Buffer = Buffer.alloc(0);
    private pendingRequests = new Map<
        number,
        { resolve: (res: any) => void; reject: (err: any) => void }
    >();
    private nextRequestId = 1;
    private initialized = false;

    constructor(private workspaceRoot: string) {}

    async start(): Promise<boolean> {
        return new Promise((resolveStart) => {
            try {
                this.process = spawn(
                    'bunx',
                    ['typescript-language-server', '--stdio'],
                    {
                        cwd: this.workspaceRoot,
                        env: { ...process.env },
                    },
                );

                this.process.stdout.on('data', (data: Buffer) => {
                    this.handleData(data);
                });

                this.process.stderr.on('data', () => {
                    // Silence stderr
                });

                this.process.on('close', () => {
                    this.cleanup();
                });

                this.process.on('error', () => {
                    resolveStart(false);
                });

                // Send initialize
                this.sendRequest('initialize', {
                    processId: process.pid,
                    rootUri: `file://${this.workspaceRoot}`,
                    rootPath: this.workspaceRoot,
                    capabilities: {
                        textDocument: {
                            rename: { dynamicRegistration: true },
                            references: { dynamicRegistration: true },
                            definition: { dynamicRegistration: true },
                        },
                    },
                })
                    .then(() => {
                        this.sendNotification('initialized', {});
                        this.initialized = true;
                        resolveStart(true);
                    })
                    .catch(() => {
                        this.cleanup();
                        resolveStart(false);
                    });
            } catch (err) {
                this.cleanup();
                resolveStart(false);
            }
        });
    }

    private cleanup() {
        this.process = null;
        this.initialized = false;
        for (const [_, req] of this.pendingRequests) {
            req.reject(new Error('LSP connection closed'));
        }
        this.pendingRequests.clear();
    }

    private handleData(data: Buffer) {
        this.buffer = Buffer.concat([this.buffer, data]);
        while (true) {
            const bufferStr = this.buffer.toString('utf-8');
            const headerMatch = bufferStr.match(
                /Content-Length: (\d+)\r\n\r\n/,
            );
            if (!headerMatch) break;

            const headerLength = headerMatch[0].length;
            const index = bufferStr.indexOf(headerMatch[0]);
            const contentLength = parseInt(headerMatch[1]!, 10);

            if (this.buffer.length < index + headerLength + contentLength)
                break;

            const content = this.buffer.slice(
                index + headerLength,
                index + headerLength + contentLength,
            );
            this.buffer = this.buffer.slice(
                index + headerLength + contentLength,
            );

            try {
                const response = JSON.parse(
                    content.toString('utf-8'),
                ) as LspResponse;
                if (response.id !== undefined) {
                    const pending = this.pendingRequests.get(response.id);
                    if (pending) {
                        this.pendingRequests.delete(response.id);
                        if (response.error) {
                            pending.reject(response.error);
                        } else {
                            pending.resolve(response.result);
                        }
                    }
                }
            } catch (err) {
                // Ignore parse errors
            }
        }
    }

    private sendRequest(method: string, params: any): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.process) {
                return reject(new Error('LSP server not running'));
            }
            const id = this.nextRequestId++;
            const msg = {
                jsonrpc: '2.0',
                id,
                method,
                params,
            };
            const payload = JSON.stringify(msg);
            const header = `Content-Length: ${Buffer.byteLength(payload, 'utf-8')}\r\n\r\n`;
            this.pendingRequests.set(id, { resolve, reject });
            this.process.stdin.write(header + payload);
        });
    }

    private sendNotification(method: string, params: any): void {
        if (!this.process) return;
        const msg = {
            jsonrpc: '2.0',
            method,
            params,
        };
        const payload = JSON.stringify(msg);
        const header = `Content-Length: ${Buffer.byteLength(payload, 'utf-8')}\r\n\r\n`;
        this.process.stdin.write(header + payload);
    }

    async getDefinition(
        filePath: string,
        line: number,
        character: number,
    ): Promise<any> {
        return this.sendRequest('textDocument/definition', {
            textDocument: { uri: `file://${resolve(filePath)}` },
            position: { line: line - 1, character },
        });
    }

    async getReferences(
        filePath: string,
        line: number,
        character: number,
    ): Promise<any> {
        return this.sendRequest('textDocument/references', {
            textDocument: { uri: `file://${resolve(filePath)}` },
            position: { line: line - 1, character },
            context: { includeDeclaration: true },
        });
    }

    async rename(
        filePath: string,
        line: number,
        character: number,
        newName: string,
    ): Promise<any> {
        return this.sendRequest('textDocument/rename', {
            textDocument: { uri: `file://${resolve(filePath)}` },
            position: { line: line - 1, character },
            newName,
        });
    }

    async shutdown() {
        if (this.process) {
            try {
                await this.sendRequest('shutdown', {});
                this.sendNotification('exit', {});
            } catch {
                // Force kill if exit fails
                this.process.kill();
            }
            this.cleanup();
        }
    }
}
