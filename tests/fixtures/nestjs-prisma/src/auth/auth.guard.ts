import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { API_KEY, TOKEN_HEADER } from './constants';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    return request.headers[TOKEN_HEADER] === API_KEY;
  }
}
