# LogSentinel Client

[![npm version](https://badge.fury.io/js/logsentinel-client.svg)](https://badge.fury.io/js/logsentinel-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A lightweight, reliable client for sending logs to LogSentinel servers. This library provides a simple interface for sending structured logs with different severity levels and supports both real-time and batch logging.

## Features

- 🚀 **Simple API** - Intuitive methods for different log levels
- 🔄 **Reliable Connections** - Automatic reconnection on network failure 
- 📦 **Batch Mode** - Efficiently send logs in batches for high-volume applications
- 📊 **Structured Logging** - Support for metadata to enhance log context
- 🔌 **Event-Based Architecture** - Monitor connection status via events
- ⚡ **Performance** - Optimized for minimal overhead

## Installation

```bash
npm install logsentinel-client
```

## Quick Start

```typescript
import { Sentinel, LogLevel } from 'logsentinel-client';

// Create a client
const sentinel = new Sentinel({
  clientId: 'your-client-id',
  projectId: 'your-project-id',
  apiKey: 'your-api-key',
  debugging: false  // Optional, enables debug logging
});

// Connect to server
await sentinel.connect();

// Send logs with different severity levels
sentinel.info('Application started');
sentinel.warning('Configuration issue detected');
sentinel.error('Failed to process payment', { 
  orderId: '12345', 
  userId: 'user789' 
});

// Close connection when done
await sentinel.close();
```

## API Reference

### Constructor Options

```typescript
new Sentinel({
  clientId: string;    // Your client identifier
  projectId: string;   // Your project identifier
  apiKey: string;      // Your API key
  debugging?: boolean; // Enable debug logs, defaults to false
  autoReconnect?: boolean; // Auto reconnect on disconnect, defaults to true
})
```

### Logging Methods

- `debug(message: string, metadata?: object): Promise<boolean>`
- `info(message: string, metadata?: object): Promise<boolean>`
- `warning(message: string, metadata?: object): Promise<boolean>`
- `error(message: string, metadata?: object): Promise<boolean>`
- `critical(message: string, metadata?: object): Promise<boolean>`
- `sendLog(message: string, level: LogLevel, metadata?: object): Promise<boolean>`

### Connection Methods

- `connect(): Promise<void>` - Connect to LogSentinel server
- `close(reason?: string): Promise<void>` - Close the connection gracefully

### Batch Mode

```typescript
// Enable batch mode for high volume logging
sentinel.enableBatchMode({
  size: 10,       // Number of logs to batch (default: 10)
  intervalMs: 2000 // Flush interval in milliseconds (default: 2000)
});

// Disable batch mode and flush any pending logs
await sentinel.disableBatchMode();
```

### Events

- `'connected'` - Emitted when successfully connected
- `'disconnected'` - Emitted on disconnection
- `'closed'` - Emitted when connection is intentionally closed
- `'error'` - Emitted on connection errors
- `'server-error'` - Emitted when server returns an error
- `'log-response'` - Emitted when log is acknowledged
- `'heartbeat'` - Emitted on server heartbeat
- `'reconnect-failed'` - Emitted when max reconnection attempts are reached

## License

MIT