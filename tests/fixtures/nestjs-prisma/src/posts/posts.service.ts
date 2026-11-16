import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  findPublished() {
    return this.prisma.post.findMany({ where: { published: true } });
  }

  countByAuthor(authorId: number) {
    return this.prisma.post.count({ where: { authorId } });
  }

  async create(authorId: number, title: string, body: string) {
    const known = await this.usersService.exists(authorId);
    if (!known) {
      throw new Error('unknown author');
    }
    return this.prisma.post.create({ data: { authorId, title, body } });
  }

  async remove(id: number) {
    await this.prisma.comment.deleteMany({ where: { postId: id } });
    return this.prisma.post.delete({ where: { id } });
  }

  validateAuthorEmail(email: string) {
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
    return normalized;
  }
}
