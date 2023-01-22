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

import { SMTPServer } from 'smtp-server'
import { ParsedMail, simpleParser as mailParser } from 'mailparser'

import { Hook, readFrom } from './config'

// The tokens which can be used in the webhook messages and will be replaced by
// the subject ot the mail content
const mailSubjectToken = '%%SUBJECT%%'
const mailContentToken = '%%CONTENT%%'

// Read the config from the given file
const configFilename = process.env.MAIL2HOOKS_CONFIG ?? 'config.json'
const config = readFrom(configFilename)

/**
 * Checks, if a hook accepts a mail and thus should be forwarded to the hook.
 * Processes the configured 'mailto' address, 'accept' filter and 'deny' filter
 * 
 * @param mail The mail which is checked
 * @param hook The relevant hook
 * @returns true, if the mail should be forwarded to the given hook, else false
 */
const accept = (mail: ParsedMail, hook: Hook): boolean => {
    // Check, if the hook is the receiver of the mail
    if (!mail.to || Array.isArray(mail.to) || !mail.to.text.toLowerCase().includes(hook.mailto.toLowerCase())) {
        return false
    }

    // Check, that we have all required data
    const bodyAsString = JSON.stringify(hook.body)
    const requiresSubject = bodyAsString.includes(mailSubjectToken)
    if (requiresSubject && !mail.subject) {
        return false
    }

    const requiresContent = bodyAsString.includes(mailContentToken)
    if (requiresContent && !mail.text) {
        return false
    }

    // Prepare the subject and the content
    const mailSubject = mail.subject
    const mailContent = mail.text

    if (hook.accept) {
        for (const pattern of hook.accept) {
            const expression = new RegExp(pattern)

            if ((mailSubject && !mailSubject.match(expression)) && (mailContent && !mailContent.match(expression))) {
                return false
            }
        }
    }

    if (hook.deny) {
        for (const pattern of hook.deny) {
            const expression = new RegExp(pattern)

            // Filter out matching the subject
            if ((mailSubject && mailSubject.match(expression)) || (mailContent && mailContent.match(expression))) {
                return false
            }
        }
    }

    return true
}

/**
 * Processes the mail by applying the replacements to the subject and content.
 * Replaces the tokens '%%SUBJECT%%' and '%%CONTENT%%' in the configured body of the hook
 * 
 * @param mail The mail to process
 * @param hook The configured hook including the message body
 * @returns The processed text to forward to the hook
 */
const processMessage = (mail: ParsedMail, hook: Hook): string => {
    // Prepare the subject and the content
    let mailSubject = mail.subject?.trim()
    let mailContent = mail.text?.trim()

    if (hook.replace) {
        for (const replacePattern in hook.replace) {
            const replaceValue = hook.replace[replacePattern]
            const replaceExpression = new RegExp(replacePattern, 'g')

            if (mailSubject) {
                mailSubject = mailSubject.replace(replaceExpression, replaceValue)
            }

            if (mailContent) {
                mailContent = mailContent.replace(replaceExpression, replaceValue)
            }
        }
    }

    // Replace data in the body
    let forwardBody = JSON.stringify(hook.body)
    if (mailSubject) {
        forwardBody = forwardBody.replace(mailSubjectToken, mailSubject)
    }
    if (mailContent) {
        forwardBody = forwardBody.replace(mailContentToken, mailContent)
    }

    return forwardBody
}

/**
 * Forwards the mail to the given webhook, if the mail is accepted by the hook
 * 
 * @param mail The mail to process
 * @param hook The relevant hook to assess
 */
const forwardMailToHook = async (mail: ParsedMail, hook: Hook): Promise<void> => {
    if (!accept(mail, hook)) {
        return
    }

    // Call the hook
    const response = await fetch(hook.target, {
        method: hook.method ?? 'POST',
        body: processMessage(mail, hook),
        headers: hook.headers
    })

    // Log errors
    if (!response.ok) {
        console.log(`Could not forward the message to hook for ${hook.mailto}, because of '${response.statusText}'`)
    }
}

/**
 * Processes the list of configured hooks and ties to forward the given mail
 * 
 * @param mail The mail to forward
 */
const forwardMailToHooks = (mail: ParsedMail) => {
    for (const hook of config.hooks) {
        forwardMailToHook(mail, hook)
    }
}

// Create the SMTP server
const server = new SMTPServer({
    allowInsecureAuth: true,
    disabledCommands: ['STARTTLS'],

    onConnect(session, callback) {
        console.log(`Client ${session.clientHostname} connected`)

        callback()
    },

    onClose(session) {
        console.log(`Client ${session.clientHostname} closed the session`)
    },

    onAuth(auth, session, callback) {
        console.log(`Received authentication from client ${session.clientHostname}`)


        const serverUser = config.server?.credentials.user ?? 'smtpuser'
        const serverPassword = config.server?.credentials.password ?? 'smtppassword'
        if (auth.username === serverUser && auth.password === serverPassword) {
            callback(null, { user: serverUser })
        } else {
            callback(new Error(`Invalid username and password from client ${session.clientHostname}`))
        }
    },

    onMailFrom(address, session, callback) {
        console.log(`Received from address ${JSON.stringify(address)} from client ${session.clientHostname}`)

        callback()
    },

    onRcptTo(address, session, callback) {
        console.log(`Received recipient address ${JSON.stringify(address)} from client ${session.clientHostname}`)

        callback()
    },

    onData(stream, session, callback) {
        console.log(`Receiving message data from ${session.clientHostname}`)

        const chunks: Uint8Array[] = []

        // Collecting chunks
        stream.on('data', chunk => chunks.push(chunk))

        // End of mail reached
        stream.on('end', () => {
            console.log(`Received mail from ${session.clientHostname}`)
            const mailData = Buffer.concat(chunks).toString('utf-8')
            console.log(`Parsing mail`)
            mailParser(mailData).then(parsedMail => {
                console.log('Forwarding mail to all hooks')
                forwardMailToHooks(parsedMail)

                callback()
            }).catch(error => {
                console.log('Error parsing the mail')
                console.log(error)

                callback(error)
            })
        })
    },
})

// Start the server and keep listening
const port = config.server?.port ?? 1025
server.listen(port, () => console.log(`mail2hooks listening on port ${port}`))
