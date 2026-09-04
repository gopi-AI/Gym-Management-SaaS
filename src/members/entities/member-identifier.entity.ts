import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Member } from './member.entity';

@Entity('MEMBERS_MEMBER_IDENTIFIERS')
export class MemberIdentifier {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  member_id!: string;

  @Column({ type: 'varchar', length: 50 })
  identifier_type!: string;

  @Column({ type: 'varchar', length: 255 })
  identifier_value!: string;

  @Column({ type: 'boolean', default: false })
  is_primary!: boolean;

  @ManyToOne(() => Member, (member) => member.identifiers)
  member!: Member;
}