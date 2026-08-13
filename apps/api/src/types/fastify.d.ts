import "fastify";
import type { UserKind, UserRole } from "@taskforge/contracts";

declare module "fastify" {
  interface FastifyRequest {
    authUser: {
      id: string;
      name: string;
      email: string | null;
      kind: UserKind;
      role: UserRole;
      tokenScopes: string[] | null;
    };
  }

  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
