import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt.guard.js';

function jwtOptions(): { secret: string; signOptions: { algorithm: 'HS256' } } {
  const secret = process.env['JWT_SECRET'];
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set (32+ chars). See .env.example.');
  }
  return { secret, signOptions: { algorithm: 'HS256' } };
}

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: jwtOptions,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [JwtModule],
})
export class AuthModule {}
