import { IsString, MinLength } from "class-validator";

export class LoginDto {
    @IsString()
    @MinLength(10)
    idToken!: string;
}
