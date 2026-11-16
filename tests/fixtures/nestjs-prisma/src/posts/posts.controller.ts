import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PostsService } from './posts.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('posts')
export class PostsController {
  constructor(
    private readonly postsService: PostsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  findPublished() {
    return this.postsService.findPublished();
  }

  @Get(':id/comments')
  comments(@Param('id') id: string) {
    // Planted layering violation: controller talks to Prisma directly.
    return this.prisma.comment.findMany({ where: { postId: Number(id) } });
  }

  @Post()
  @UseGuards(AuthGuard)
  create(@Body() body: { authorId: number; title: string; body: string }) {
    return this.postsService.create(body.authorId, body.title, body.body);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  remove(@Param('id') id: string) {
    return this.postsService.remove(Number(id));
  }
}
