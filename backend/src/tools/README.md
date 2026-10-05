# Tools

Every free Rothenhall tool lives here as its own NestJS module. See `../../AGENTS.md` for
the full context.

## Add a tool

1. Create `src/tools/<tool-name>/` (kebab-case).
2. Add `<tool-name>.module.ts`, `.controller.ts`, `.service.ts` and a `dto/` folder.
   Nest CLI helps: `npx nest g module tools/<tool-name>`, then `controller` and `service`.
3. Namespace the route: `@Controller('tools/<tool-name>')`.
4. Write a `README.md` in the tool folder: purpose as a funnel step, inputs, outputs,
   environment variables, limits.
5. Import the module in `src/app.module.ts`.
6. Add tests next to the code.

## Rules

- No imports between tools. Shared code goes in `src/common/`.
- Validate every request body with a DTO.
- Secrets only from environment variables.
