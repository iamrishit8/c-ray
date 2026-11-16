import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PostsService } from '../posts/posts.service';
import { Page } from '../common/pagination';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly postsService: PostsService,
  ) {}

  findAll(page: Page) {
    return this.prisma.user.findMany({ skip: page.skip, take: page.take });
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      return null;
    }
    const postCount = await this.postsService.countByAuthor(id);
    return { ...user, postCount };
  }

  create(email: string, name?: string) {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes('@')) {
      throw new Error('invalid email');
    }
    if (normalized.length > 254) {
      throw new Error('email too long');
    }
    const domain = normalized.split('@')[1];
    if (!domain || !domain.includes('.')) {
      throw new Error('invalid domain');
    }
    return this.prisma.user.create({ data: { email: normalized, name } });
  }

  exists(id: number) {
    return this.prisma.user.count({ where: { id } }).then((count) => count > 0);
  }
}
