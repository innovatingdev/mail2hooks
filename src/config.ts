/*
 * mail2hooks - EMail to webhook mapper
 * Copyright (C) 2023 The Innovating Developer <contact@innovating.dev>
 * 
 * This file is part of mail2hooks.
 * 
 * mail2hooks is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 * 
 * mail2hooks is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with mail2hooks.
 * If not, see <https://www.gnu.org/licenses/>.
 */

import { z } from 'zod'

import * as fs from 'fs'

// Definition of a single webhook
const Hook =
    z.object({
        comment: z.string().optional(),
        mailto: z.string(),
        accept: z.array(z.string()).optional(),
        deny: z.array(z.string()).optional(),
        replace: z.record(z.string()).optional(),
        target: z.string(),
        method: z.enum(['GET', 'PUT', 'POST']).optional(),
        body: z.union([z.string(), z.record(z.any())]),
        headers: z.record(z.string()).optional()
    })
export type Hook = z.infer<typeof Hook>

// The configuration is a list of hooks
const Config =
    z.object({
        server: z.object({
            port: z.number().min(0).max(65535).optional(),
            credentials: z.object({
                user: z.string().min(1),
                password: z.string().min(1)
            })
        }).optional(),
        hooks: z.array(Hook)
    })
export type Config = z.infer<typeof Config>

/**
 * Load a configuration from the filesystem
 * 
 * @param path The path of the configuration files
 * @returns The read config file
 * @throws an exception, if something went wrong reading the file
 */
// Read the configuration from the file
export const readFrom = (path: string): Config => {
    const fileContent = JSON.parse(fs.readFileSync(path).toString('utf-8'))

    return Config.parse(fileContent)
}
