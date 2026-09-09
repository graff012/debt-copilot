import { Body, Controller, Headers, HttpCode, Inject, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { Session, type SessionUser } from '../tenant/org.decorator.js';
import { LinkConfirmDto } from './telegram.dto.js';
import { TelegramService } from './telegram.service.js';

@Controller('telegram')
export class TelegramController {
  constructor(@Inject(TelegramService) private readonly service: TelegramService) {}

  @Post('link-code')
  linkCode(@Session() user: SessionUser) {
    return this.service.issueLink(user);
  }

  // Bot-to-server call: no user JWT, authorized by the shared bot secret instead.
  @Public()
  @Post('confirm')
  @HttpCode(200)
  confirm(@Body() body: LinkConfirmDto, @Headers('x-bot-secret') secret: string | undefined) {
    return this.service.confirm(body.code, body.telegramUserId, secret ?? '');
  }
}
