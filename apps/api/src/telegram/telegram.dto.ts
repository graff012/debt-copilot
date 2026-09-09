import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

export class LinkConfirmDto {
  @IsString()
  @MaxLength(64)
  code!: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  telegramUserId!: number;
}
