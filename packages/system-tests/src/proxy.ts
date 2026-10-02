import { connect, createServer, type Server, type Socket } from "node:net";

/**
 * A TCP hop between the services and a dependency (RabbitMQ, SMTP). down()
 * cuts every open connection and refuses new ones, as an outage would;
 * up() listens on the same port again, so nothing has to be reconfigured.
 */
export class TcpProxy {
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();
  port = 0;

  constructor(
    private readonly targetHost: string,
    private readonly targetPort: number,
  ) {}

  async up() {
    this.server = createServer((client) => {
      const upstream = connect(this.targetPort, this.targetHost);
      for (const socket of [client, upstream]) {
        this.sockets.add(socket);
        socket.on("close", () => this.sockets.delete(socket));
        socket.on("error", () => socket.destroy());
      }
      client.pipe(upstream).pipe(client);
      client.on("close", () => upstream.destroy());
      upstream.on("close", () => client.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.port, "127.0.0.1", () => resolve());
    });
    const address = this.server.address();
    if (typeof address === "object" && address) this.port = address.port;
  }

  async down() {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
    this.server = undefined;
  }
}
