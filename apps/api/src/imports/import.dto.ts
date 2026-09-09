import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ImportRowDto {
  @IsInt()
  @Min(1)
  rowNumber!: number;

  @IsOptional()
  @IsString()
  customerName?: string | null;

  @IsOptional()
  @IsString()
  tin?: string | null;

  @IsOptional()
  @IsString()
  externalCustomerId?: string | null;

  @IsOptional()
  @IsString()
  invoiceNumber?: string | null;

  @IsOptional()
  @IsString()
  invoiceDate?: string | null;

  @IsOptional()
  @IsString()
  dueDate?: string | null;

  @IsOptional()
  @IsString()
  remainingRaw?: string | null;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}

export class ImportBodyDto {
  @IsString()
  @MaxLength(300)
  filename!: string;

  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows!: ImportRowDto[];
}
