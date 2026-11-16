import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthGuard } from '../auth/auth.guard';
import { toPage } from '../common/pagination';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll(@Query('page') page?: string, @Query('size') size?: string) {
    return this.usersService.findAll(toPage(page, size));
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(Number(id));
  }

  @Post()
  @UseGuards(AuthGuard)
  create(@Body() body: { email: string; name?: string }) {
    return this.usersService.create(body.email, body.name);
  }
}
