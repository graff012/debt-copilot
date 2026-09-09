import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { LoginDto, RefreshDto, SignupDto } from './auth.dto.js';
import { Public } from './public.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly service: AuthService) {}

  @Public()
  @Post('signup')
  signup(@Body() body: SignupDto) {
    return this.service.signup(body);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginDto) {
    return this.service.login(body);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: RefreshDto) {
    return this.service.refresh(body.refreshToken);
  }

  // The refresh token itself is the credential here (it is presented to be killed).
  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Body() body: RefreshDto) {
    return this.service.logout(body.refreshToken);
  }
}
