import { ForbiddenError, UnauthenticatedError, NotFoundError } from "./errors.js";
import type { RequestContext } from "./context.js";
import type { UserEntity } from "./models.js";
import type { UnitOfWork } from "./repositories.js";
import type { AuthService } from "./services.js";

export interface PasswordVerifier { compare(password: string, hash: string): Promise<boolean>; }
export interface TokenIssuer { issue(user: UserEntity): string; }

export class AuthApplicationService implements AuthService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly passwords: PasswordVerifier, private readonly tokens: TokenIssuer) {}
  async authenticate(input: { email: string; password: string }) { return this.unitOfWork.run(async (repositories) => { const result = await repositories.users.findByEmail(input.email); if (!result?.passwordHash || !(await this.passwords.compare(input.password, result.passwordHash))) throw new UnauthenticatedError("Invalid email or password"); const user: UserEntity = result; return { user, token: this.tokens.issue(user) }; }); }
  async currentUser(context: RequestContext) { return this.unitOfWork.run(async (repositories) => { const user = await repositories.users.findById(context.actor.userId); if (!user) throw new NotFoundError("User"); return user; }); }
}
