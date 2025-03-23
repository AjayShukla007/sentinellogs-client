import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { EventEmitter } from "events";
import { resolve } from "path";

const DEFAULT_SERVER_URL = "localhost:50051";
// Define the package interface
export interface LogSentinelOptions {
  clientId: string;
  projectId: string;
  apiKey: string;
  serverUrl?: string;
  debugging?: boolean;
  autoReconnect?: boolean;
}

// Define log levels
enum LogLevel {
  DEBUGGING = "debugging",
  INFO = "info",
  WARNING = "warning",
  ERROR = "error",
  CRITICAL = "critical",
}

// Define metadata type
export type LogMetadata = Record<string, string | number | boolean>;

/**
 * Sentinel client for LogSentinel service
 */
class Sentinel extends EventEmitter {
  private client: any;
  private stream: any;
  private connected: boolean = false;
  private connecting: boolean = false;
  private clientId: string;
  private projectId: string;
  private apiKey: string;
  private sessionId: string | null = null;
  private serverUrl: string | null = DEFAULT_SERVER_URL;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private debugging: boolean;
  private autoReconnect: boolean = true;

  // Add these properties to your class
  private batchQueue: {
    message: string;
    level: LogLevel;
    metadata?: LogMetadata;
  }[] = [];
  private batchSize: number = 10;
  private batchInterval: number = 2000; // 2 seconds
  private batchTimeout: NodeJS.Timeout | null = null;
  private batchingEnabled: boolean = false;

  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 2;

  /**
   * Create a new Sentinel instance
   * @param options Connection options
   */
  constructor(options: LogSentinelOptions) {
    super();
    this.clientId = options.clientId;
    this.projectId = options.projectId;
    this.apiKey = options.apiKey;
    this.serverUrl = options.serverUrl || DEFAULT_SERVER_URL;
    this.debugging = options.debugging || false;
    this.autoReconnect = options.autoReconnect !== false;

    // Initialize gRPC client without connecting
    this.initializeClient();
  }

  /**
   * Initialize the gRPC client without connecting
   */
  private initializeClient(): void {
    try {
      // Load the proto file
      const protoPath = resolve(__dirname, "./proto/logsentinel.proto");
      this.logDebug("Loading proto from:", protoPath);

      const packageDefinition = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });

      const proto = grpc.loadPackageDefinition(packageDefinition);
      // Access the service using proper type assertions and nested property access
      const logSentinelProto = proto.logsentinel as any;

      // Create client
      this.client = new logSentinelProto.LogService(
        this.serverUrl,
        grpc.credentials.createInsecure()
      );
    } catch (error) {
      this.logDebug("Error initializing client:", error);
      throw new Error(`Failed to initialize LogSentinel client: ${error}`);
    }
  }

  /**
   * Connect to the LogSentinel server
   * @returns Promise that resolves when connected
   */
  public connect(): Promise<void> {
    // Check for valid credentials before attempting connection
    if (!this.clientId || !this.projectId || !this.apiKey) {
      console.log(
        "Missing credentials:",
        this.clientId,
        this.projectId,
        this.apiKey
      );

      return Promise.reject(
        new Error(
          "Missing credentials: clientId, projectId, and apiKey are required"
        )
      );
    }

    if (this.connected) {
      return Promise.resolve();
    }

    if (this.connecting) {
      return new Promise((resolve) => {
        this.once("connected", () => resolve());
      });
    }

    this.connecting = true;
    this.logDebug("Connecting to LogSentinel server...");

    return new Promise((resolve, reject) => {
      try {
        // Create bidirectional stream
        this.stream = this.client.ConnectClient();

        // Handle incoming messages
        this.stream.on("data", (response: any) => {
          this.handleServerMessage(response);
        });

        // Handle stream end
        this.stream.on("end", () => {
          this.logDebug("Stream ended by server");
          this.handleDisconnect();
        });

        // Handle errors
        this.stream.on("error", (error: Error) => {
          this.logDebug("Stream error:", error);
          this.handleDisconnect();

          // If still connecting, reject the promise
          if (this.connecting) {
            this.connecting = false;
            reject(error);
          }
        });

        // Send auth request
        // this.stream.write({
        //   auth: {
        //     clientId: this.clientId,
        //     projectId: this.projectId,
        //     apiKey: this.apiKey
        //   }
        // });
        // Send auth request
        // this.stream.write({
        //   message: {
        //     auth: {
        //       clientId: this.clientId,
        //       projectId: this.projectId,
        //       apiKey: this.apiKey,
        //     },
        //   },
        // });
        // Send auth request
this.stream.write({
  auth: {  // This directly maps to the oneof field
    client_id: this.clientId,
    project_id: this.projectId,
    api_key: this.apiKey
  }
});

        // Set timeout for connection
        const connectionTimeout = setTimeout(() => {
          if (!this.connected && this.connecting) {
            this.connecting = false;
            reject(new Error("Connection timed out"));
            this.handleDisconnect();
          }
        }, 26000);

        // When connected event occurs, resolve the promise
        this.once("connected", () => {
          clearTimeout(connectionTimeout);
          this.connecting = false;
          resolve();
        });
      } catch (error) {
        this.connecting = false;
        console.log("Error connecting to LogSentinel server:", error);

        reject(error);
      }
    });
  }

  /**
   * Handle messages from the server
   */
  private handleServerMessage(message: any): void {
    if (!message) return;
    
    // Log incoming message structure during debug
    if (this.debugging) {
      console.log("[LogSentinel] Server message:", JSON.stringify(message, null, 2));
    }

    // Checking both possible locations for the auth_response
    if (message.auth_response || (message.message === "auth_response" && message.auth_response)) {
      const authResponse = message.auth_response;
      
      if (authResponse.success) {
        this.sessionId = authResponse.session_id || authResponse.sessionId;
        this.connected = true;
        this.connecting = false;
        this.logDebug("Connected to LogSentinel with session:", this.sessionId);

        // Setup heartbeat
        this.setupHeartbeat();

        // Emit connected event - this is the critical line!
        this.emit("connected");
        return;
      } else {
        this.logDebug("Authentication failed:", authResponse.message);
        this.handleDisconnect();
        this.emit("error", new Error(`Authentication failed: ${authResponse.message}`));
        return;
      }
    }

    // Simpler detection for heartbeats
    if (message.pong || (message.message === "pong")) {
      this.logDebug("Received heartbeat from server");
      this.emit("heartbeat");
      return;
    }

    // Log response handling
    if (message.log_response || (message.message === "log_response")) {
      const logResponse = message.log_response || message;
      this.logDebug("Log response:", logResponse.message);
      this.emit("log-response", logResponse);
      return;
    }

    // Error message handling
    if (message.error || (message.message === "error")) {
      const error = message.error || message;
      this.logDebug("Error from server:", error.code, error.message);
      this.emit("server-error", { code: error.code, message: error.message });
      return;
    }

    // If we get here, log the unhandled message type
    this.logDebug("Unhandled message type:", message);
  }

  /**
   * Send a log message to the server
   * @param message Log message
   * @param level Log level
   * @param metadata Additional metadata
   * @returns Promise that resolves when the log is sent
   */
  public async sendLog(
    message: string,
    level: LogLevel = LogLevel.INFO,
    metadata?: LogMetadata
  ): Promise<boolean> {
    // If batching is enabled, add to queue
    if (this.batchingEnabled) {
      this.batchQueue.push({ message, level, metadata });

      // If queue reaches batch size, flush immediately
      if (this.batchQueue.length >= this.batchSize) {
        this.flushBatchQueue().catch((err) => {
          this.logDebug("Error flushing batch queue:", err);
        });
      }

      return true;
    } else {
      // Send immediately if not batching
      return this.sendLogImmediate(message, level, metadata);
    }
  }

  /**
   * Send a log message to the server immediately
   * @param message Log message
   * @param level Log level
   * @param metadata Additional metadata
   * @returns Promise that resolves when the log is sent
   */
  private async sendLogImmediate(
    message: string,
    level: LogLevel = LogLevel.INFO,
    metadata?: LogMetadata
  ): Promise<boolean> {
    // Ensure connection
    if (!this.connected) {
      try {
        await this.connect();
      } catch (error: any) {
        throw new Error(`Failed to connect: ${error.message}`);
      }
    }

    return new Promise((resolve, reject) => {
      try {
        // Send log message
        this.stream.write(
          {
            log: {
              category: level,
              message: message,
              metadata: metadata || {},
            },
          },
          (error?: Error) => {
            if (error) {
              this.logDebug("Error sending log:", error);
              reject(error);
            } else {
              resolve(true);
            }
          }
        );
      } catch (error) {
        this.logDebug("Exception sending log:", error);
        reject(error);
      }
    });
  }

  /**
   * Set up heartbeat to keep connection alive
   */
  private setupHeartbeat(): void {
    // Clear any existing heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Send heartbeat every 25 seconds (server timeout is 30s)
    this.heartbeatInterval = setInterval(() => {
      if (this.connected) {
        try {
          this.stream.write({
            ping: {
              timestamp: Date.now(),
            },
          });
          this.logDebug("Sent heartbeat");
        } catch (error) {
          this.logDebug("Error sending heartbeat:", error);
          this.handleDisconnect();
        }
      }
    }, 20000);
  }

  /**
   * Handle disconnection from server
   */
  private handleDisconnect(): void {
    if (this.connected || this.connecting) {
      this.logDebug("Disconnected from server");
      this.connected = false;
      this.connecting = false;

      // Clear heartbeat interval
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      // Emit disconnected event
      this.emit("disconnected");

      // Schedule reconnect
      if (this.autoReconnect) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Schedule a reconnect attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logDebug(
        `Maximum reconnect attempts (${this.maxReconnectAttempts}) reached`
      );
      this.emit(
        "reconnect-failed",
        new Error(
          `Failed to reconnect after ${this.maxReconnectAttempts} attempts`
        )
      );
      return;
    }

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      this.logDebug(
        `Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
      );
      this.connect()
        .then(() => {
          this.reconnectAttempts = 0; // Reset counter on success
        })
        .catch((error) => {
          this.logDebug("Reconnect failed:", error);
          this.scheduleReconnect();
        });
    }, 5000);
  }

  /**
   * Close the connection to the server
   * @param reason Reason for closing
   */
  public close(reason: string = "Client requested close"): Promise<void> {
    return new Promise((resolve) => {
      if (!this.connected) {
        resolve();
        return;
      }

      // Clear timers
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }

      // Send close message
      try {
        this.stream.write({
          close: {
            reason: reason,
          },
        });

        // Give the server a moment to process the close message
        setTimeout(() => {
          this.stream.end();
          this.connected = false;
          this.emit("closed");
          resolve();
        }, 500);
      } catch (error) {
        this.logDebug("Error closing connection:", error);
        this.stream.end();
        this.connected = false;
        this.emit("closed");
        resolve();
      }
    });
  }

  /**
   * Debug logging
   */
  private logDebug(...args: any[]): void {
    if (this.debugging) {
      console.log("[LogSentinel]", ...args);
    }
  }

  /**
   * Convenience method for sending debug logs
   * @param message Log message
   * @param metadata Additional metadata
   */
  public debug(message: string, metadata?: LogMetadata): Promise<boolean> {
    return this.sendLog(message, LogLevel.DEBUGGING, metadata);
  }

  /**
   * Convenience method for sending info logs
   * @param message Log message
   * @param metadata Additional metadata
   */
  public info(message: string, metadata?: LogMetadata): Promise<boolean> {
    return this.sendLog(message, LogLevel.INFO, metadata);
  }

  /**
   * Convenience method for sending warning logs
   * @param message Log message
   * @param metadata Additional metadata
   */
  public warning(message: string, metadata?: LogMetadata): Promise<boolean> {
    return this.sendLog(message, LogLevel.WARNING, metadata);
  }

  /**
   * Convenience method for sending error logs
   * @param message Log message
   * @param metadata Additional metadata
   */
  public error(message: string, metadata?: LogMetadata): Promise<boolean> {
    return this.sendLog(message, LogLevel.ERROR, metadata);
  }

  /**
   * Convenience method for sending critical logs
   * @param message Log message
   * @param metadata Additional metadata
   */
  public critical(message: string, metadata?: LogMetadata): Promise<boolean> {
    return this.sendLog(message, LogLevel.CRITICAL, metadata);
  }

  /**
   * Enable batch mode for high-volume logging
   * @param options Batch configuration options
   */
  public enableBatchMode(options?: {
    size?: number;
    intervalMs?: number;
  }): void {
    this.batchSize = options?.size || 10;
    this.batchInterval = options?.intervalMs || 2000;
    this.batchingEnabled = true;
    this.setupBatchProcessing();
  }

  /**
   * Disable batch mode and flush any pending logs
   */
  public async disableBatchMode(): Promise<void> {
    this.batchingEnabled = false;
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    // Flush any pending logs
    await this.flushBatchQueue();
  }

  /**
   * Set up the batch processing timer
   */
  private setupBatchProcessing(): void {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }

    this.batchTimeout = setInterval(() => {
      if (this.batchQueue.length > 0) {
        this.flushBatchQueue().catch((err) => {
          this.logDebug("Error flushing batch queue:", err);
        });
      }
    }, this.batchInterval);
  }

  /**
   * Flush the batch queue
   */
  private async flushBatchQueue(): Promise<void> {
    if (this.batchQueue.length === 0) return;

    // Take the current queue and reset it
    const logsToSend = [...this.batchQueue];
    this.batchQueue = [];

    // Todo: Implement batch sending to the server using BatchSendLogs endpoint
    // For now, send them individually
    try {
      const promises = logsToSend.map((log) =>
        this.sendLogImmediate(log.message, log.level, log.metadata)
      );
      await Promise.all(promises);
    } catch (error) {
      this.logDebug("Error sending batch logs:", error);
      // Put failed logs back in queue
      this.batchQueue = [...logsToSend, ...this.batchQueue];
    }
  }

  /**
   * Create and connect a new Sentinel client
   * @param options Connection options
   * @returns Promise that resolves to connected Sentinel instance
   */
  public static async createClient(
    options: LogSentinelOptions
  ): Promise<Sentinel> {
    const client = new Sentinel(options);
    await client.connect();
    return client;
  }
}

// Main export should be a factory function
// export default function createSentinel() {
//   return {
//     connect: async (options: LogSentinelOptions): Promise<Sentinel> => {
//       const sentinel = new Sentinel(options);
//       await sentinel.connect();
//       return sentinel;
//     }
//   };
// }

// Still export the class and enum for advanced usage
export { Sentinel, LogLevel };
