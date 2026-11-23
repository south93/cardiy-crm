import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../config/app-config';
import { FilesModule } from '../files/files.module';
import { AccessService } from './access.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { MeController } from './me.controller';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({ secret: config.get('JWT_SECRET'), signOptions: { issuer: 'cardiy' }, verifyOptions: { issuer: 'cardiy' } }),
    }),
    FilesModule,
  ],
  controllers: [AuthController, MeController],
  providers: [AuthService, AccessService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService, AccessService, JwtModule],
})
export class AuthModule {}
