import { IsEmpty, IsString, Length } from 'class-validator';

/** Only provider references and non-sensitive display metadata cross this boundary. */
export class AttachPaymentMethodDto {
  @IsEmpty({ message: 'Raw card data must not be submitted' })
  card_number?: never;

  @IsEmpty({ message: 'Raw card data must not be submitted' })
  card_cvc?: never;

  @IsEmpty({ message: 'Raw card data must not be submitted' })
  card_exp_month?: never;

  @IsEmpty({ message: 'Raw card data must not be submitted' })
  card_exp_year?: never;

  @IsString()
  @Length(1, 255)
  stripe_customer_id!: string;

  @IsString()
  @Length(1, 255)
  stripe_payment_method_id!: string;

  @IsString()
  @Length(1, 50)
  card_brand!: string;

  @IsString()
  @Length(4, 4)
  card_last4!: string;
}