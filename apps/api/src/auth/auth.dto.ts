import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const trim = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class SignupDto {
  @IsString()
  @MaxLength(200)
  organizationName!: string;

  @IsString()
  @MaxLength(64)
  timeZone!: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @trim()
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(72)
  password!: string;
}

export class LoginDto {
  @trim()
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password!: string;

  // Required only when the email exists in several orgs (409 tells you).
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class RefreshDto {
  @IsString()
  @MaxLength(128)
  refreshToken!: string;
}
