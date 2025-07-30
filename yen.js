import { Api, TelegramClient } from "telegram"
import { StringSession } from "telegram/sessions/index.js"
import input from "input"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const BLUE = "\x1b[34m"
const WHITE = "\x1b[37m"
const RESET = "\x1b[0m"

const ACCOUNTS_DIR = path.join(__dirname, "accounts")
if (!fs.existsSync(ACCOUNTS_DIR)) {
  fs.mkdirSync(ACCOUNTS_DIR, { recursive: true })
}

const GROUPS_DATA_DIR = path.join(__dirname, "groups_data")
if (!fs.existsSync(GROUPS_DATA_DIR)) {
  fs.mkdirSync(GROUPS_DATA_DIR, { recursive: true })
}

const CACHE_DIR = path.join(__dirname, "cache")
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clearConsole() {
  console.clear()
}

function shouldSuppressError(error) {
  if (!error || !error.message) return false
  const errorMsg = error.message.toLowerCase()
  return (
    errorMsg.includes("timeout") ||
    errorMsg.includes("timed out") ||
    errorMsg.includes("etimedout") ||
    errorMsg.includes("network error") ||
    errorMsg.includes("connection") ||
    errorMsg.includes("disconnected") ||
    errorMsg.includes("socket")
  )
}

const originalConsoleError = console.error
console.error = (...args) => {
  if (args.length > 0) {
    const errorString = args.join(" ")
    if (
      errorString.toLowerCase().includes("timeout") ||
      errorString.toLowerCase().includes("timed out") ||
      errorString.toLowerCase().includes("etimedout") ||
      errorString.toLowerCase().includes("network error") ||
      errorString.toLowerCase().includes("connection") ||
      errorString.toLowerCase().includes("disconnected") ||
      errorString.toLowerCase().includes("socket")
    ) {
      return
    }
  }
  originalConsoleError.apply(console, args)
}

function success(message) {
  console.log(`${GREEN}${message}${RESET}`)
}

function error(message) {
  console.log(`${RED}${message}${RESET}`)
}

function info(message) {
  console.log(`${BLUE}${message}${RESET}`)
}

function updateConsoleTitle(title) {
  if (process.platform === "win32") {
    process.stdout.write(`\x1B]0;${title}\x07`)
  }
}

function getSavedAccounts() {
  const accounts = []

  if (fs.existsSync(ACCOUNTS_DIR)) {
    const files = fs.readdirSync(ACCOUNTS_DIR)
    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const accountData = JSON.parse(fs.readFileSync(path.join(ACCOUNTS_DIR, file), "utf8"))
          accounts.push({
            filename: file,
            apiId: accountData.apiId,
            apiHash: accountData.apiHash,
            phoneNumber: accountData.phoneNumber,
            sessionString: accountData.sessionString,
          })
        } catch (fileError) {
          console.error(`Error reading account file ${file}:`, fileError.message)
        }
      }
    }
  }

  return accounts
}

async function manageAccounts() {
  clearConsole()
  info("=== MANAGE ACCOUNTS ===")

  const accounts = getSavedAccounts()

  if (accounts.length > 0) {
    console.log(`${WHITE}\nSaved accounts:${RESET}`)
    accounts.forEach((account, index) => {
      console.log(`${WHITE}${index + 1}. ${account.phoneNumber || "Unknown"} (${account.filename})${RESET}`)
    })
  } else {
    console.log(`${WHITE}\nNo saved accounts found.${RESET}`)
  }

  console.log(`${WHITE}\n1. Add New Account${RESET}`)
  console.log(`${WHITE}2. Delete Account${RESET}`)
  console.log(`${WHITE}3. Leave All Groups${RESET}`)
  console.log(`${WHITE}4. Back to Main Menu${RESET}`)

  let choice
  try {
    choice = await input.text("Select an option: ")
  } catch (inputError) {
    return manageAccounts()
  }

  switch (choice) {
    case "1":
      await addNewAccount()
      break
    case "2":
      await deleteAccount(accounts)
      break
    case "3":
      await leaveAllGroups(accounts)
      break
    case "4":
      await displayMainMenu()
      break
    default:
      error("Invalid option.")
      await sleep(1500)
      await manageAccounts()
  }
}

async function leaveAllGroups(accounts) {
  if (accounts.length === 0) {
    error("No accounts found. Please add an account first.")
    await sleep(1500)
    await manageAccounts()
    return
  }

  clearConsole()
  info("=== LEAVE ALL GROUPS ===")

  console.log(`${WHITE}\nSelect account to use:${RESET}`)
  accounts.forEach((account, index) => {
    console.log(`${WHITE}${index + 1}. ${account.phoneNumber || "Unknown"}${RESET}`)
  })

  let selectedAccountIndex
  try {
    selectedAccountIndex = Number.parseInt(await input.text("Select an account: ")) - 1
  } catch (inputError) {
    return leaveAllGroups(accounts)
  }

  if (selectedAccountIndex < 0 || selectedAccountIndex >= accounts.length) {
    error("Invalid account selection.")
    await sleep(1500)
    return leaveAllGroups(accounts)
  }

  const selectedAccount = accounts[selectedAccountIndex]
  console.log(`${WHITE}\nSelected account: ${selectedAccount.phoneNumber}${RESET}`)

  let leaveDelay
  try {
    leaveDelay = Number.parseFloat(await input.text("Enter delay between leaving groups in seconds (e.g. 5): "))
  } catch (inputError) {
    leaveDelay = 5
    console.log(`${WHITE}Using default delay: ${leaveDelay} seconds${RESET}`)
  }

  let confirmLeave
  try {
    confirmLeave = await input.text("Are you sure you want to leave ALL groups with this account? (y/n): ")
  } catch (inputError) {
    confirmLeave = "n"
  }

  if (confirmLeave.toLowerCase() !== "y") {
    console.log(`${WHITE}Operation cancelled.${RESET}`)
    await sleep(1500)
    await manageAccounts()
    return
  }

  let client
  try {
    client = await connectClient(selectedAccount)
  } catch (connectionError) {
    error(`Failed to connect to account ${selectedAccount.phoneNumber}.`)
    await sleep(1500)
    await manageAccounts()
    return
  }

  try {
    console.log(`${WHITE}\nFetching dialogs...${RESET}`)
    const dialogs = await client.getDialogs()

    const groups = dialogs.filter((dialog) => {
      const entity = dialog.entity
      return (entity.className === "Channel" && entity.megagroup === true) || entity.className === "Chat"
    })

    if (groups.length === 0) {
      error("No groups found for this account.")
      await client.disconnect()
      await sleep(1500)
      await manageAccounts()
      return
    }

    info(`\nFound ${groups.length} groups to leave.`)

    let currentDelay = leaveDelay
    let successCount = 0
    let failCount = 0

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]
      const entity = group.entity
      const groupName = entity.title || entity.username || entity.id

      console.log(`${WHITE}\nLeaving group ${groupName} (${i + 1}/${groups.length})...${RESET}`)

      try {
        if (entity.className === "Channel") {
          await client.invoke(
            new Api.channels.LeaveChannel({
              channel: entity,
            }),
          )
          success(`✓ Left group ${groupName}`)
          successCount++
        } else if (entity.className === "Chat") {
          await client.invoke(
            new Api.messages.DeleteChatUser({
              chatId: entity.id,
              userId: "me",
            }),
          )
          success(`✓ Left group ${groupName}`)
          successCount++
        }
      } catch (leaveError) {
        const floodWaitMatch = leaveError.message.match(/FLOOD_WAIT_(\d+)/)
        if (floodWaitMatch) {
          const waitSeconds = Number.parseInt(floodWaitMatch[1])
          console.log(`${WHITE}⚠️ Rate limit hit! Waiting for ${waitSeconds} seconds...${RESET}`)

          await sleep(waitSeconds * 1000)

          currentDelay = currentDelay * 2
          console.log(`${WHITE}Increased delay to ${currentDelay} seconds for future operations${RESET}`)

          try {
            if (entity.className === "Channel") {
              await client.invoke(
                new Api.channels.LeaveChannel({
                  channel: entity,
                }),
              )
              success(`✓ Left group ${groupName} after waiting`)
              successCount++
            } else if (entity.className === "Chat") {
              await client.invoke(
                new Api.messages.DeleteChatUser({
                  chatId: entity.id,
                  userId: "me",
                }),
              )
              success(`✓ Left group ${groupName} after waiting`)
              successCount++
            }
          } catch (retryError) {
            error(`✗ Failed to leave group ${groupName}: ${retryError.message}`)
            failCount++
          }
        } else {
          error(`✗ Failed to leave group ${groupName}: ${leaveError.message}`)
          failCount++
        }
      }

      if (i < groups.length - 1) {
        await sleep(currentDelay * 1000)
      }
    }

    info(`\nOperation completed. Left ${successCount} groups, Failed: ${failCount}`)
    await client.disconnect()
    await sleep(1500)
    await manageAccounts()
  } catch (accountError) {
    error(`Error processing account: ${accountError.message}`)
    if (client) {
      try {
        await client.disconnect()
      } catch (disconnectError) {
        console.error("Error disconnecting client:", disconnectError.message)
      }
    }
    await sleep(1500)
    await manageAccounts()
  }
}

async function addNewAccount() {
  clearConsole()
  info("=== ADD NEW ACCOUNT ===")

  let apiId, apiHash, phoneNumber

  try {
    apiId = Number.parseInt(await input.text("Enter your API ID: "))
    apiHash = await input.text("Enter your API Hash: ")
    phoneNumber = await input.text("Enter your phone number: ")
  } catch (inputError) {
    console.log(`${RED}Error reading input. Returning to account management...${RESET}`)
    await sleep(1500)
    return manageAccounts()
  }

  if (isNaN(apiId) || !apiHash || !phoneNumber) {
    error("Invalid input. Please provide valid API ID, API Hash, and phone number.")
    await sleep(1500)
    return addNewAccount()
  }

  console.log(`${WHITE}\nConnecting to Telegram...${RESET}`)

  const stringSession = new StringSession("")
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
    useWSS: false,
    timeout: 60000,
  })

  try {
    await client.start({
      phoneNumber: async () => phoneNumber,
      password: async () => {
        try {
          return await input.text("Password (if any): ")
        } catch (inputError) {
          return ""
        }
      },
      phoneCode: async () => {
        try {
          return await input.text("Verification code: ")
        } catch (inputError) {
          return ""
        }
      },
      onError: (err) => {
        console.error("Authentication error:", err.message)
      },
    })

    const sessionString = client.session.save()
    await client.disconnect()

    const accounts = getSavedAccounts()
    let nextAccountNumber = 1

    if (accounts.length > 0) {
      const accountNumbers = accounts.map((a) => {
        const match = a.filename.match(/account(\d+)\.json/)
        return match ? Number.parseInt(match[1]) : 0
      })

      nextAccountNumber = Math.max(...accountNumbers) + 1
    }

    const accountFilename = `account${nextAccountNumber}.json`
    const accountData = {
      apiId,
      apiHash,
      phoneNumber,
      sessionString,
    }

    fs.writeFileSync(path.join(ACCOUNTS_DIR, accountFilename), JSON.stringify(accountData, null, 2))

    success(`\nAccount successfully added as ${accountFilename}`)
    await sleep(1500)
    await manageAccounts()
  } catch (connectionError) {
    error(`Connection issue: ${connectionError.message}. Please try again.`)
    await sleep(1500)
    await manageAccounts()
  }
}

async function deleteAccount(accounts) {
  if (accounts.length === 0) {
    error("No accounts to delete.")
    await sleep(1500)
    await manageAccounts()
    return
  }

  clearConsole()
  info("=== DELETE ACCOUNT ===")
  console.log(`${WHITE}\nSelect account to delete:${RESET}`)

  accounts.forEach((account, index) => {
    console.log(`${WHITE}${index + 1}. ${account.phoneNumber || "Unknown"} (${account.filename})${RESET}`)
  })

  console.log(`${WHITE}${accounts.length + 1}. Cancel${RESET}`)

  let choice
  try {
    choice = Number.parseInt(await input.text("Select an option: "))
  } catch (inputError) {
    return deleteAccount(accounts)
  }

  if (choice >= 1 && choice <= accounts.length) {
    const accountToDelete = accounts[choice - 1]
    let confirm
    try {
      confirm = await input.text(`Are you sure you want to delete ${accountToDelete.filename}? (y/n): `)
    } catch (inputError) {
      confirm = "n"
    }

    if (confirm.toLowerCase() === "y") {
      try {
        fs.unlinkSync(path.join(ACCOUNTS_DIR, accountToDelete.filename))

        const accountNumber = accountToDelete.filename.match(/account(\d+)\.json/)[1]
        const groupDataFile = path.join(GROUPS_DATA_DIR, `account${accountNumber}-groups.json`)
        if (fs.existsSync(groupDataFile)) {
          fs.unlinkSync(groupDataFile)
        }

        const cacheFiles = fs.readdirSync(CACHE_DIR)
        for (const file of cacheFiles) {
          if (file.startsWith(`account${accountNumber}-`)) {
            fs.unlinkSync(path.join(CACHE_DIR, file))
          }
        }

        success("Account deleted successfully.")
      } catch (deleteError) {
        error(`Error deleting account: ${deleteError.message}`)
      }
    } else {
      console.log(`${WHITE}Deletion cancelled.${RESET}`)
    }
  } else if (choice === accounts.length + 1) {
    console.log(`${WHITE}Operation cancelled.${RESET}`)
  } else {
    error("Invalid option.")
  }

  await sleep(1500)
  await manageAccounts()
}

async function connectClient(accountData) {
  const stringSession = new StringSession(accountData.sessionString)
  const client = new TelegramClient(stringSession, accountData.apiId, accountData.apiHash, {
    connectionRetries: 5,
    useWSS: false,
    timeout: 60000,
    retryDelay: 2000,
  })

  try {
    await client.connect()
    success(`Connected as ${accountData.phoneNumber}`)
    return client
  } catch (connectionError) {
    error(`Connection issue with ${accountData.phoneNumber}. ${connectionError.message}`)
    throw connectionError
  }
}

async function scrapeGroupMembers() {
  clearConsole()
  info("=== SCRAPE GROUP MEMBERS ===")

  const accounts = getSavedAccounts()

  if (accounts.length === 0) {
    error("No accounts found. Please add an account first.")
    await sleep(1500)
    await displayMainMenu()
    return
  }

  console.log(`${WHITE}\nSelect account to use:${RESET}`)
  accounts.forEach((account, index) => {
    console.log(`${WHITE}${index + 1}. ${account.phoneNumber || "Unknown"}${RESET}`)
  })

  let selectedAccountIndex
  try {
    selectedAccountIndex = Number.parseInt(await input.text("Select an account: ")) - 1
  } catch (inputError) {
    return scrapeGroupMembers()
  }

  if (selectedAccountIndex < 0 || selectedAccountIndex >= accounts.length) {
    error("Invalid account selection.")
    await sleep(1500)
    return scrapeGroupMembers()
  }

  const selectedAccount = accounts[selectedAccountIndex]
  console.log(`${WHITE}\nSelected account: ${selectedAccount.phoneNumber}${RESET}`)

  console.log(`${WHITE}\nHow would you like to select a group?${RESET}`)
  console.log(`${WHITE}1. Enter a group link${RESET}`)
  console.log(`${WHITE}2. Choose from groups I'm already in${RESET}`)

  let groupSelectionChoice
  try {
    groupSelectionChoice = await input.text("Select an option (1-2): ")
  } catch (inputError) {
    return scrapeGroupMembers()
  }

  let client
  try {
    client = await connectClient(selectedAccount)
  } catch (connectionError) {
    error(`Failed to connect to account ${selectedAccount.phoneNumber}.`)
    await sleep(1500)
    await displayMainMenu()
    return
  }

  let targetGroup

  if (groupSelectionChoice === "1") {
    let groupLink
    try {
      groupLink = await input.text("Enter the group link (e.g., t.me/groupname): ")
      groupLink = groupLink
        .replace(/^https:\/\//, "")
        .replace(/^t\.me\//, "")
        .replace(/\/$/, "")
    } catch (inputError) {
      await client.disconnect()
      return scrapeGroupMembers()
    }

    try {
      targetGroup = await client.getEntity(groupLink)
    } catch (entityError) {
      error("Could not find the group. Make sure the link is correct and you are a member of the group.")
      await client.disconnect()
      await sleep(1500)
      await displayMainMenu()
      return
    }
  } else if (groupSelectionChoice === "2") {
    try {
      console.log(`${WHITE}\nFetching your groups...${RESET}`)
      const dialogs = await client.getDialogs()

      const groups = dialogs.filter((dialog) => {
        const entity = dialog.entity
        return entity.className === "Channel" && entity.megagroup === true
      })

      if (groups.length === 0) {
        error("No groups found for this account.")
        await client.disconnect()
        await sleep(1500)
        await displayMainMenu()
        return
      }

      console.log(`${WHITE}\nYour groups:${RESET}`)
      groups.forEach((group, index) => {
        console.log(`${WHITE}${index + 1}. ${group.entity.title} (${group.entity.username || group.entity.id})${RESET}`)
      })

      let groupIndex
      try {
        groupIndex = Number.parseInt(await input.text("Select a group: ")) - 1
      } catch (inputError) {
        await client.disconnect()
        return scrapeGroupMembers()
      }

      if (groupIndex < 0 || groupIndex >= groups.length) {
        error("Invalid group selection.")
        await client.disconnect()
        await sleep(1500)
        await displayMainMenu()
        return
      }

      targetGroup = groups[groupIndex].entity
    } catch (dialogError) {
      error("Error fetching groups.")
      await client.disconnect()
      await sleep(1500)
      await displayMainMenu()
      return
    }
  } else {
    error("Invalid option.")
    await client.disconnect()
    await sleep(1500)
    await displayMainMenu()
    return
  }

  info(`\nSelected group: ${targetGroup.title || targetGroup.username || targetGroup.id}`)

  let limit
  try {
    limit = Number.parseInt(await input.text("Enter maximum number of members to scrape (0 for all): "))
  } catch (inputError) {
    limit = 0
  }

  if (isNaN(limit) || limit < 0) {
    limit = 0
  }

  info(`\nScraping members from ${targetGroup.title || targetGroup.username || targetGroup.id}...`)
  console.log(`${WHITE}This may take a while depending on the group size.${RESET}`)

  try {
    const members = []
    let offset = 0
    const batchSize = 200
    let totalFetched = 0
    let hasMore = true

    while (hasMore && (limit === 0 || totalFetched < limit)) {
      const currentLimit = limit === 0 ? batchSize : Math.min(batchSize, limit - totalFetched)

      const participants = await client.invoke(
        new Api.channels.GetParticipants({
          channel: targetGroup,
          filter: new Api.ChannelParticipantsSearch({ q: "" }),
          offset: offset,
          limit: currentLimit,
          hash: 0,
        }),
      )

      if (!participants.users || participants.users.length === 0) {
        hasMore = false
        break
      }

      for (const user of participants.users) {
        if (user.className === "User" && !user.bot) {
          members.push({
            id: user.id,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            phone: user.phone,
            accessHash: user.accessHash,
          })
        }
      }

      totalFetched += participants.users.length
      offset += participants.users.length

      console.log(`${WHITE}Fetched ${totalFetched} members so far...${RESET}`)

      await sleep(2000)
    }

    success(`\nSuccessfully scraped ${members.length} members.`)

    const accountNumber = selectedAccount.filename.match(/account(\d+)\.json/)[1]
    const groupName = targetGroup.username || targetGroup.id.toString()
    const fileName = `group_members_${groupName}_${Date.now()}.json`
    const filePath = path.join(CACHE_DIR, fileName)

    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          groupInfo: {
            id: targetGroup.id,
            title: targetGroup.title,
            username: targetGroup.username,
          },
          members: members,
          scrapedAt: Date.now(),
        },
        null,
        2,
      ),
    )

    const txtFileName = `group_members_${groupName}_${Date.now()}.txt`
    const txtFilePath = path.join(CACHE_DIR, txtFileName)

    const usernameLines = members
      .filter((m) => m.username)
      .map((m) => m.username)
      .join("\n")

    fs.writeFileSync(txtFilePath, usernameLines)

    success(`Members saved to ${filePath}`)
    success(`Usernames saved to ${txtFilePath}`)

    await client.disconnect()
    await sleep(1500)
    await displayScraperMenu()
  } catch (scrapeError) {
    error(`Error scraping group members: ${scrapeError.message}`)
    if (client) {
      await client.disconnect()
    }
    await sleep(1500)
    await displayScraperMenu()
  }
}

async function canWriteInChat(client, chat) {
  try {
    const result = await client.invoke(
      new Api.channels.GetParticipant({
        channel: chat,
        participant: "me",
      }),
    )

    if (result.participant && result.participant.className === "ChannelParticipantCreator") {
      return { canWrite: true }
    }

    if (result.participant && result.participant.className === "ChannelParticipantAdmin") {
      return { canWrite: !result.participant.bannedRights?.sendMessages, reason: "Admin with restricted rights" }
    }

    if (result.participant && result.participant.className === "ChannelParticipant") {
      return { canWrite: !result.participant.bannedRights?.sendMessages, reason: "Restricted user" }
    }

    return { canWrite: true, reason: "Unknown" }
  } catch (apiError) {
    if (apiError.message.includes("USER_NOT_PARTICIPANT")) {
      return { canWrite: false, reason: "Not a participant" }
    }

    return { canWrite: false, reason: apiError.message }
  }
}

async function getTopicsForChat(client, chat) {
  try {
    const result = await client.invoke(
      new Api.channels.GetForumTopics({
        channel: chat,
        offsetId: 0,
        limit: 100,
      }),
    )

    if (result && result.topics) {
      return result.topics
    }

    return []
  } catch (apiError) {
    return []
  }
}

async function displayChatTopics(topics) {
  console.log(`${WHITE}  Available topics:${RESET}`)
  topics.forEach((topic) => {
    console.log(`${WHITE}    - ${topic.title} (ID: ${topic.id}, Closed: ${topic.closed ? "Yes" : "No"})${RESET}`)
  })
}

async function getRandomOpenTopic(topics) {
  const openTopics = topics.filter((t) => !t.closed)

  if (openTopics.length === 0) {
    return null
  }

  const randomIndex = Math.floor(Math.random() * openTopics.length)
  return openTopics[randomIndex].id
}

function loadGroupsDataForAccount(accountNumber) {
  const groupDataFile = path.join(GROUPS_DATA_DIR, `account${accountNumber}-groups.json`)

  if (fs.existsSync(groupDataFile)) {
    try {
      const data = fs.readFileSync(groupDataFile, "utf8")
      return JSON.parse(data)
    } catch (fileError) {
      console.error(`Error loading groups data: ${fileError.message}`)
      return null
    }
  }

  return null
}

function saveGroupsDataForAccount(accountNumber, groupsData) {
  const groupDataFile = path.join(GROUPS_DATA_DIR, `account${accountNumber}-groups.json`)
  fs.writeFileSync(groupDataFile, JSON.stringify(groupsData, null, 2))
}

function loadPrivateChatsForAccount(accountNumber) {
  const chatsDataFile = path.join(CACHE_DIR, `account${accountNumber}-private-chats.json`)

  if (fs.existsSync(chatsDataFile)) {
    try {
      const data = fs.readFileSync(chatsDataFile, "utf8")
      return JSON.parse(data)
    } catch (fileError) {
      console.error(`Error loading private chats data: ${fileError.message}`)
      return null
    }
  }

  return null
}

function savePrivateChatsForAccount(accountNumber, chatsData) {
  const chatsDataFile = path.join(CACHE_DIR, `account${accountNumber}-private-chats.json`)
  fs.writeFileSync(chatsDataFile, JSON.stringify(chatsData, null, 2))
}

async function checkGroupPermissionsForAccount(account, checkDelay) {
  info(`\nChecking groups for account ${account.phoneNumber}...`)

  let client
  try {
    client = await connectClient(account)
  } catch (connectionError) {
    error(`Failed to connect to account ${account.phoneNumber}. Skipping.`)
    return null
  }

  try {
    console.log(`${WHITE}Fetching dialogs...${RESET}`)
    const dialogs = await client.getDialogs()

    const publicGroups = dialogs.filter((dialog) => {
      const entity = dialog.entity
      return entity.className === "Channel" && entity.megagroup === true
    })

    console.log(`${WHITE}Found ${publicGroups.length} groups for ${account.phoneNumber}${RESET}`)

    if (publicGroups.length === 0) {
      console.log(`${RED}No groups found to forward to.${RESET}`)
      await client.disconnect()
      return null
    }

    const groupsWithInfo = []

    for (let i = 0; i < publicGroups.length; i++) {
      const dialog = publicGroups[i]
      const entity = dialog.entity
      const entityName = entity.username || entity.id

      console.log(`${WHITE}\nChecking group ${i + 1}/${publicGroups.length}: ${entityName}${RESET}`)

      try {
        const writeStatus = await canWriteInChat(client, entity)
        if (writeStatus.canWrite) {
          success(`  Can write: Yes`)
        } else {
          error(`  Can write: No - ${writeStatus.reason}`)
        }

        const topics = await getTopicsForChat(client, entity)
        const hasTopics = topics.length > 0
        console.log(`${WHITE}  Has topics: ${hasTopics ? "Yes" : "No"}${RESET}`)

        if (hasTopics) {
          await displayChatTopics(topics)
        }

        const groupInfo = {
          entity: {
            id: entity.id,
            username: entity.username,
            title: entity.title,
            accessHash: entity.accessHash,
          },
          hasTopics,
          writeStatus,
          topics: topics.map((t) => ({
            id: t.id,
            title: t.title,
            closed: t.closed,
          })),
        }

        groupsWithInfo.push(groupInfo)

        if (i < publicGroups.length - 1) {
          await sleep(checkDelay * 1000)
        }
      } catch (groupError) {
        console.error(`Error checking group ${entityName}:`, groupError.message)
      }
    }

    if (groupsWithInfo.length === 0) {
      error(`No valid groups found for account ${account.phoneNumber}.`)
      await client.disconnect()
      return null
    }

    const accountNumber = account.filename.match(/account(\d+)\.json/)[1]
    const groupsData = {
      groups: groupsWithInfo,
      lastUpdated: Date.now(),
    }

    saveGroupsDataForAccount(accountNumber, groupsData)

    await client.disconnect()
    return groupsWithInfo
  } catch (groupCheckError) {
    error(`Error checking groups for account ${account.phoneNumber}: ${groupCheckError.message}`)
    if (client) {
      try {
        await client.disconnect()
      } catch (disconnectError) {
        console.error("Error disconnecting client:", disconnectError.message)
      }
    }
    return null
  }
}

async function forwardMessages() {
  clearConsole()
  info("=== FORWARD MESSAGES ===")

  const accounts = getSavedAccounts()

  if (accounts.length === 0) {
    error("No accounts found. Please add an account first.")
    await sleep(1500)
    await displayMainMenu()
    return
  }

  console.log(`${WHITE}\nSelect forwarding mode:${RESET}`)
  console.log(`${WHITE}1. Standard Forward (one message at a time)${RESET}`)
  console.log(`${WHITE}2. Batch Forward (multiple messages to one group)${RESET}`)
  console.log(`${WHITE}3. Back to Main Menu${RESET}`)

  let forwardMode
  try {
    forwardMode = await input.text("Select an option (1-3): ")
  } catch (inputError) {
    return forwardMessages()
  }

  if (forwardMode === "3") {
    await displayMainMenu()
    return
  }

  if (forwardMode !== "1" && forwardMode !== "2") {
    error("Invalid option.")
    await sleep(1500)
    return forwardMessages()
  }

  console.log(`${WHITE}\nSelect accounts to use:${RESET}`)
  accounts.forEach((account, index) => {
    console.log(`${WHITE}${index + 1}. ${account.phoneNumber || "Unknown"}${RESET}`)
  })

  let selectedAccountsInput
  try {
    selectedAccountsInput = await input.text("Enter account numbers separated by commas (e.g., 1,2): ")
  } catch (inputError) {
    return forwardMessages()
  }

  const selectedIndices = selectedAccountsInput.split(",").map((num) => Number.parseInt(num.trim()) - 1)

  const selectedAccounts = selectedIndices
    .filter((index) => index >= 0 && index < accounts.length)
    .map((index) => accounts[index])

  if (selectedAccounts.length === 0) {
    error("No valid accounts selected.")
    await sleep(1500)
    await forwardMessages()
    return
  }

  console.log(`${WHITE}\nSelected ${selectedAccounts.length} accounts.${RESET}`)

  const accountsWithGroupData = []
  const accountsNeedingGroupCheck = []

  for (const account of selectedAccounts) {
    const accountNumber = account.filename.match(/account(\d+)\.json/)[1]
    const groupData = loadGroupsDataForAccount(accountNumber)

    if (groupData && groupData.groups && groupData.groups.length > 0) {
      const lastCheckedDate = new Date(groupData.lastUpdated)
      info(`Found group data for ${account.phoneNumber} from ${lastCheckedDate.toLocaleString()}.`)

      accountsWithGroupData.push({
        account,
        groupData,
      })
    } else {
      console.log(`${WHITE}No group data found for ${account.phoneNumber}. Will check groups.${RESET}`)
      accountsNeedingGroupCheck.push(account)
    }
  }

  if (accountsNeedingGroupCheck.length > 0) {
    info(`\nChecking groups for ${accountsNeedingGroupCheck.length} accounts.`)
    let checkDelay
    try {
      checkDelay = Number.parseFloat(await input.text("Enter delay between checking groups in seconds (e.g. 0.5): "))
    } catch (inputError) {
      checkDelay = 0.5
    }

    for (const account of accountsNeedingGroupCheck) {
      const groupsWithInfo = await checkGroupPermissionsForAccount(account, checkDelay)

      if (groupsWithInfo && groupsWithInfo.length > 0) {
        accountsWithGroupData.push({
          account,
          groupData: {
            groups: groupsWithInfo,
            lastUpdated: Date.now(),
          },
        })
      }
    }
  }

  if (accountsWithGroupData.length === 0) {
    error("No accounts with valid group data. Cannot forward messages.")
    await sleep(1500)
    await displayMainMenu()
    return
  }

  if (forwardMode === "1") {
    await standardForward(accountsWithGroupData)
  } else {
    await batchForward(accountsWithGroupData)
  }
}

async function standardForward(accountsWithGroupData) {
  let messageCount
  try {
    messageCount = Number.parseInt(await input.text("How many messages do you want to forward? "))
    if (isNaN(messageCount) || messageCount < 1) {
      error("Invalid number of messages. Please enter a positive number.")
      await sleep(1500)
      return forwardMessages()
    }
  } catch (inputError) {
    error("Error reading input. Operation cancelled.")
    await sleep(1500)
    await displayMainMenu()
    return
  }

  const accountConfigs = []

  for (const { account, groupData } of accountsWithGroupData) {
    info(`\nConfiguration for account ${account.phoneNumber}:`)

    const writableGroups = groupData.groups.filter((g) => g.writeStatus.canWrite)
    const topicGroups = groupData.groups.filter((g) => g.hasTopics && g.writeStatus.canWrite)

    console.log(`${WHITE}- ${writableGroups.length} groups where you can write${RESET}`)
    console.log(`${WHITE}- ${topicGroups.length} groups with topics${RESET}`)

    if (writableGroups.length === 0) {
      error(`No writable groups found for ${account.phoneNumber}. Skipping this account.`)
      continue
    }

    const messageSources = []
    for (let i = 0; i < messageCount; i++) {
      console.log(`${WHITE}\nEnter details for message ${i + 1}:${RESET}`)

      let sourceChannelId, messageId
      try {
        sourceChannelId = await input.text(`Enter source channel username or ID for message ${i + 1}: `)
        messageId = Number.parseInt(await input.text(`Enter message ID for message ${i + 1}: `))
      } catch (inputError) {
        error("Error reading input. Skipping this account.")
        break
      }

      messageSources.push({
        sourceChannelId,
        messageId,
      })
    }

    let forwardDelay
    try {
      forwardDelay = Number.parseFloat(await input.text("Enter delay between forwards in seconds (e.g. 1.5): "))
    } catch (inputError) {
      error("Error reading input. Skipping this account.")
      continue
    }

    accountConfigs.push({
      account,
      messageSources,
      initialDelay: forwardDelay,
      currentDelay: forwardDelay,
      writableGroups,
    })
  }

  if (accountConfigs.length === 0) {
    error("No accounts configured for forwarding. Operation cancelled.")
    await sleep(1500)
    await displayMainMenu()
    return
  }

  let durationHours, cycleMins
  try {
    durationHours = Number.parseFloat(
      await input.text("Enter how many hours to run the forwarding process (e.g. 24): "),
    )
    cycleMins = Number.parseFloat(await input.text("Enter minutes between each forwarding cycle (e.g. 30): "))
  } catch (inputError) {
    durationHours = 24
    cycleMins = 30
    console.log(
      `${WHITE}Using default values: ${durationHours} hours duration, ${cycleMins} minutes between cycles.${RESET}`,
    )
  }

  const totalCycles = Math.floor((durationHours * 60) / cycleMins)
  info(`\nThis will run approximately ${totalCycles} cycles over ${durationHours} hours.`)

  let confirmForward
  try {
    confirmForward = await input.text("Start forwarding messages? (y/n): ")
  } catch (inputError) {
    confirmForward = "n"
  }

  if (confirmForward.toLowerCase() !== "y") {
    console.log(`${WHITE}Operation cancelled.${RESET}`)
    await sleep(1500)
    await displayMainMenu()
    return
  }

  info("\nStarting forwarding process...")

  let cycleCount = 0
  const startTime = Date.now()
  const endTime = startTime + durationHours * 60 * 60 * 1000
  let totalSuccessCount = 0
  let totalFailCount = 0

  updateConsoleTitle(`[S] ${totalSuccessCount} [F] ${totalFailCount}`)

  while (Date.now() < endTime) {
    cycleCount++
    info(`\n=== Starting Cycle ${cycleCount} ===`)

    const connectedClients = []

    for (const config of accountConfigs) {
      try {
        const client = await connectClient(config.account)

        const messageIndex = (cycleCount - 1) % config.messageSources.length
        const currentMessageSource = config.messageSources[messageIndex]

        let sourceChannel
        try {
          sourceChannel = await client.getEntity(currentMessageSource.sourceChannelId)
        } catch (sourceError) {
          error(`Connection issue with source channel for ${config.account.phoneNumber}. Skipping.`)
          await client.disconnect()
          continue
        }

        connectedClients.push({
          client,
          config,
          sourceChannel,
          currentMessageSource,
        })
      } catch (connectError) {
        console.error(`Error connecting client for ${config.account.phoneNumber}:`, connectError.message)
      }
    }

    if (connectedClients.length === 0) {
      error("Failed to connect to any accounts. Ending process.")
      break
    }

    const forwardingPromises = connectedClients.map(({ client, config, sourceChannel, currentMessageSource }) => {
      return forwardWithClient(client, config, sourceChannel, currentMessageSource.messageId)
    })

    const results = await Promise.all(forwardingPromises)

    for (const result of results) {
      if (result && Array.isArray(result)) {
        const successCount = result.filter((r) => r.success).length
        const failCount = result.filter((r) => !r.success).length

        totalSuccessCount += successCount
        totalFailCount += failCount

        updateConsoleTitle(`[S] ${totalSuccessCount} [F] ${totalFailCount}`)
      }
    }

    for (const { client } of connectedClients) {
      try {
        await client.disconnect()
      } catch (disconnectError) {
        console.error("Error disconnecting client:", disconnectError.message)
      }
    }

    if (Date.now() >= endTime) {
      info("\nReached the specified duration. Ending process.")
      break
    }

    const nextCycleTime = new Date(Date.now() + cycleMins * 60 * 1000)
    info(`\nCycle ${cycleCount} completed. Next cycle will start at ${nextCycleTime.toLocaleTimeString()}`)
    console.log(`${WHITE}Waiting ${cycleMins} minutes...${RESET}`)

    await sleep(cycleMins * 60 * 1000)
  }

  success("\nForwarding process completed.")
  await sleep(1500)
  await displayMainMenu()
}

async function batchForward(accountsWithGroupData) {
  let batchSize
  try {
    batchSize = Number.parseInt(await input.text("How many messages do you want to forward in each batch? "))
    if (isNaN(batchSize) || batchSize < 1) {
      error("Invalid batch size. Please enter a positive number.")
      await sleep(1500)
      return forwardMessages()
    }
  } catch (inputError) {
    error(`Error reading input. Operation cancelled.`)
    await sleep(1500)
    await displayMainMenu()
    return
  }

  const accountConfigs = []

  for (const { account, groupData } of accountsWithGroupData) {
    info(`\nConfiguration for account ${account.phoneNumber}:`)

    const writableGroups = groupData.groups.filter((g) => g.writeStatus.canWrite)
    const topicGroups = groupData.groups.filter((g) => g.hasTopics && g.writeStatus.canWrite)

    console.log(`${WHITE}- ${writableGroups.length} groups where you can write${RESET}`)
    console.log(`${WHITE}- ${topicGroups.length} groups with topics${RESET}`)

    if (writableGroups.length === 0) {
      error(`No writable groups found for ${account.phoneNumber}. Skipping this account.`)
      continue
    }

    const messageBatches = []
    console.log(`${WHITE}\nEnter details for batch of ${batchSize} messages:${RESET}`)

    const messageSources = []
    for (let i = 0; i < batchSize; i++) {
      console.log(`${WHITE}\nEnter details for message ${i + 1}:${RESET}`)

      let sourceChannelId, messageId
      try {
        sourceChannelId = await input.text(`Enter source channel username or ID for message ${i + 1}: `)
        messageId = Number.parseInt(await input.text(`Enter message ID for message ${i + 1}: `))
      } catch (inputError) {
        error(`Error reading input. Skipping this account.`)
        break
      }

      messageSources.push({
        sourceChannelId,
        messageId,
      })
    }

    messageBatches.push(messageSources)

    let forwardDelay, batchDelay
    try {
      forwardDelay = Number.parseFloat(
        await input.text("Enter delay between messages in a batch in seconds (e.g. 1.5): "),
      )
      batchDelay = Number.parseFloat(await input.text("Enter delay between batches in seconds (e.g. 5): "))
    } catch (inputError) {
      error(`Error reading input. Skipping this account.`)
      continue
    }

    accountConfigs.push({
      account,
      messageBatches,
      initialMessageDelay: forwardDelay,
      currentMessageDelay: forwardDelay,
      initialBatchDelay: batchDelay,
      currentBatchDelay: batchDelay,
      writableGroups,
    })
  }

  if (accountConfigs.length === 0) {
    error("No accounts configured for forwarding. Operation cancelled.")
    await sleep(1500)
    await displayMainMenu()
    return
  }

  let durationHours, cycleMins
  try {
    durationHours = Number.parseFloat(
      await input.text("Enter how many hours to run the forwarding process (e.g. 24): "),
    )
    cycleMins = Number.parseFloat(await input.text("Enter minutes between each forwarding cycle (e.g. 30): "))
  } catch (inputError) {
    durationHours = 24
    cycleMins = 30
    console.log(
      `${WHITE}Using default values: ${durationHours} hours duration, ${cycleMins} minutes between cycles.${RESET}`,
    )
  }

  const totalCycles = Math.floor((durationHours * 60) / cycleMins)
  info(`\nThis will run approximately ${totalCycles} cycles over ${durationHours} hours.`)

  let confirmForward
  try {
    confirmForward = await input.text("Start batch forwarding messages? (y/n): ")
  } catch (inputError) {
    confirmForward = "n"
  }

  if (confirmForward.toLowerCase() !== "y") {
    console.log(`${WHITE}Operation cancelled.${RESET}`)
    await sleep(1500)
    await displayMainMenu()
    return
  }

  info("\nStarting batch forwarding process...")

  let cycleCount = 0
  const startTime = Date.now()
  const endTime = startTime + durationHours * 60 * 60 * 1000
  let totalSuccessCount = 0
  let totalFailCount = 0

  updateConsoleTitle(`[S] ${totalSuccessCount} [F] ${totalFailCount}`)

  try {
    while (Date.now() < endTime) {
      cycleCount++
      info(`\n=== Starting Cycle ${cycleCount} ===`)

      for (const config of accountConfigs) {
        let client
        try {
          client = await connectClient(config.account)

          for (const groupInfo of config.writableGroups) {
            info(
              `\nForwarding batch to ${groupInfo.entity.title || groupInfo.entity.username || groupInfo.entity.id}...`,
            )

            const inputPeer = new Api.InputPeerChannel({
              channelId: groupInfo.entity.id,
              accessHash: groupInfo.entity.accessHash || 0,
            })

            const batchIndex = (cycleCount - 1) % config.messageBatches.length
            const currentBatch = config.messageBatches[batchIndex]

            let batchSuccessCount = 0
            let batchFailCount = 0

            for (let i = 0; i < currentBatch.length; i++) {
              const messageSource = currentBatch[i]

              try {
                const sourceChannel = await client.getEntity(messageSource.sourceChannelId)

                try {
                  if (groupInfo.hasTopics) {
                    const topicId = await getRandomOpenTopic(groupInfo.topics)

                    await client.invoke(
                      new Api.messages.ForwardMessages({
                        fromPeer: sourceChannel,
                        id: [messageSource.messageId],
                        randomId: [Math.floor(Math.random() * 2147483647)],
                        toPeer: inputPeer,
                        topMsgId: topicId,
                        withMyScore: false,
                        dropAuthor: false,
                        dropMediaCaptions: false,
                      }),
                    )

                    success(
                      `✓ Forwarded message ${i + 1}/${currentBatch.length} to ${groupInfo.entity.username || groupInfo.entity.id} (topic: ${topicId})`,
                    )
                  } else {
                    await client.invoke(
                      new Api.messages.ForwardMessages({
                        fromPeer: sourceChannel,
                        id: [messageSource.messageId],
                        randomId: [Math.floor(Math.random() * 2147483647)],
                        toPeer: inputPeer,
                        withMyScore: false,
                        dropAuthor: false,
                        dropMediaCaptions: false,
                      }),
                    )

                    success(
                      `✓ Forwarded message ${i + 1}/${currentBatch.length} to ${groupInfo.entity.username || groupInfo.entity.id}`,
                    )
                  }

                  batchSuccessCount++
                  totalSuccessCount++
                } catch (forwardError) {
                  const floodWaitMatch = forwardError.message.match(/FLOOD_WAIT_(\d+)/)
                  if (floodWaitMatch) {
                    const waitSeconds = Number.parseInt(floodWaitMatch[1])
                    console.log(`${WHITE}⚠️ Rate limit hit! Waiting for ${waitSeconds} seconds...${RESET}`)

                    await sleep(waitSeconds * 1000)

                    config.currentMessageDelay = config.currentMessageDelay * 2
                    console.log(
                      `${WHITE}Increased message delay to ${config.currentMessageDelay} seconds for future messages${RESET}`,
                    )

                    try {
                      if (groupInfo.hasTopics) {
                        const topicId = await getRandomOpenTopic(groupInfo.topics)

                        await client.invoke(
                          new Api.messages.ForwardMessages({
                            fromPeer: sourceChannel,
                            id: [messageSource.messageId],
                            randomId: [Math.floor(Math.random() * 2147483647)],
                            toPeer: inputPeer,
                            topMsgId: topicId,
                            withMyScore: false,
                            dropAuthor: false,
                            dropMediaCaptions: false,
                          }),
                        )
                      } else {
                        await client.invoke(
                          new Api.messages.ForwardMessages({
                            fromPeer: sourceChannel,
                            id: [messageSource.messageId],
                            randomId: [Math.floor(Math.random() * 2147483647)],
                            toPeer: inputPeer,
                            withMyScore: false,
                            dropAuthor: false,
                            dropMediaCaptions: false,
                          }),
                        )
                      }

                      success(`✓ Forwarded message ${i + 1}/${currentBatch.length} after waiting`)
                      batchSuccessCount++
                      totalSuccessCount++
                    } catch (retryError) {
                      error(`✗ Failed to forward message ${i + 1}/${currentBatch.length}: ${retryError.message}`)
                      batchFailCount++
                      totalFailCount++
                    }
                  } else {
                    error(`✗ Failed to forward message ${i + 1}/${currentBatch.length}: ${forwardError.message}`)
                    batchFailCount++
                    totalFailCount++
                  }
                }

                if (i < currentBatch.length - 1) {
                  await sleep(config.currentMessageDelay * 1000)
                }
              } catch (sourceError) {
                error(`✗ Error with source channel for message ${i + 1}/${currentBatch.length}: ${sourceError.message}`)
                batchFailCount++
                totalFailCount++
              }
            }

            info(
              `\nBatch forwarding to ${groupInfo.entity.username || groupInfo.entity.id} completed. Success: ${batchSuccessCount}, Failed: ${batchFailCount}`,
            )

            if (groupInfo !== config.writableGroups[config.writableGroups.length - 1]) {
              await sleep(config.currentBatchDelay * 1000)
            }
          }

          await client.disconnect()
        } catch (batchError) {
          error(`Error processing account ${config.account.phoneNumber}: ${batchError.message}`)
          if (client) {
            try {
              await client.disconnect()
            } catch (disconnectErr) {
              console.error("Error disconnecting client:", disconnectErr.message)
            }
          }
        }
      }

      updateConsoleTitle(`[S] ${totalSuccessCount} [F] ${totalFailCount}`)

      if (Date.now() >= endTime) {
        info("\nReached the specified duration. Ending process.")
        break
      }

      const nextCycleTime = new Date(Date.now() + cycleMins * 60 * 1000)
      info(`\nCycle ${cycleCount} completed. Next cycle will start at ${nextCycleTime.toLocaleTimeString()}`)
      console.log(`${WHITE}Waiting ${cycleMins} minutes...${RESET}`)

      await sleep(cycleMins * 60 * 1000)
    }
  } catch (unexpectedError) {
    console.error(`Unexpected error in batch forward: ${unexpectedError.message}`)
  }

  success("\nBatch forwarding process completed.")
  await sleep(1500)
  await displayMainMenu()
}

async function forwardWithClient(client, config, sourceChannel, messageId) {
  info(`\nForwarding with account ${config.account.phoneNumber}...`)
  console.log(`${WHITE}Current delay between forwards: ${config.currentDelay} seconds${RESET}`)

  const results = []

  for (const groupInfo of config.writableGroups) {
    try {
      const inputPeer = new Api.InputPeerChannel({
        channelId: groupInfo.entity.id,
        accessHash: groupInfo.entity.accessHash || 0,
      })

      try {
        if (groupInfo.hasTopics) {
          const topicId = await getRandomOpenTopic(groupInfo.topics)

          await client.invoke(
            new Api.messages.ForwardMessages({
              fromPeer: sourceChannel,
              id: [messageId],
              randomId: [Math.floor(Math.random() * 2147483647)],
              toPeer: inputPeer,
              topMsgId: topicId,
              withMyScore: false,
              dropAuthor: false,
              dropMediaCaptions: false,
            }),
          )

          success(`✓ Forwarded to ${groupInfo.entity.username || groupInfo.entity.id} (topic: ${topicId})`)
        } else {
          await client.invoke(
            new Api.messages.ForwardMessages({
              fromPeer: sourceChannel,
              id: [messageId],
              randomId: [Math.floor(Math.random() * 2147483647)],
              toPeer: inputPeer,
              withMyScore: false,
              dropAuthor: false,
              dropMediaCaptions: false,
            }),
          )

          success(`✓ Forwarded to ${groupInfo.entity.username || groupInfo.entity.id}`)
        }

        results.push({
          success: true,
          group: groupInfo.entity.username || groupInfo.entity.id,
        })
      } catch (forwardError) {
        const floodWaitMatch = forwardError.message.match(/FLOOD_WAIT_(\d+)/)
        if (floodWaitMatch) {
          const waitSeconds = Number.parseInt(floodWaitMatch[1])
          console.log(`${WHITE}⚠️ Rate limit hit! Waiting for ${waitSeconds} seconds...${RESET}`)

          await sleep(waitSeconds * 1000)

          config.currentDelay = config.currentDelay * 2
          console.log(`${WHITE}Increased delay to ${config.currentDelay} seconds for future forwards${RESET}`)

          console.log(`${WHITE}Retrying forward to ${groupInfo.entity.username || groupInfo.entity.id}...${RESET}`)

          try {
            if (groupInfo.hasTopics) {
              const topicId = await getRandomOpenTopic(groupInfo.topics)

              await client.invoke(
                new Api.messages.ForwardMessages({
                  fromPeer: sourceChannel,
                  id: [messageId],
                  randomId: [Math.floor(Math.random() * 2147483647)],
                  toPeer: inputPeer,
                  topMsgId: topicId,
                  withMyScore: false,
                  dropAuthor: false,
                  dropMediaCaptions: false,
                }),
              )
            } else {
              await client.invoke(
                new Api.messages.ForwardMessages({
                  fromPeer: sourceChannel,
                  id: [messageId],
                  randomId: [Math.floor(Math.random() * 2147483647)],
                  toPeer: inputPeer,
                  withMyScore: false,
                  dropAuthor: false,
                  dropMediaCaptions: false,
                }),
              )
            }

            success(`✓ Successfully forwarded after waiting`)
            results.push({
              success: true,
              group: groupInfo.entity.username || groupInfo.entity.id,
            })
          } catch (retryError) {
            error(
              `✗ Failed to forward to ${groupInfo.entity.username || groupInfo.entity.id} after retry: ${retryError.message}`,
            )
            results.push({
              success: false,
              group: groupInfo.entity.username || groupInfo.entity.id,
              error: retryError.message,
            })
          }
        } else {
          let errorMessage = forwardError.message

          if (shouldSuppressError(forwardError)) {
            errorMessage = "Connection issue"
          } else {
            if (errorMessage.includes("CHAT_WRITE_FORBIDDEN")) {
              errorMessage = "Writing is forbidden in this chat"
            } else if (errorMessage.includes("TOPIC_CLOSED")) {
              errorMessage = "The topic is closed"
            } else if (errorMessage.includes("CHANNEL_PRIVATE")) {
              errorMessage = "The channel is private or you are not a member"
            }

            error(`✗ Failed to forward to ${groupInfo.entity.username || groupInfo.entity.id}: ${errorMessage}`)
          }

          results.push({
            success: false,
            group: groupInfo.entity.username || groupInfo.entity.id,
            error: errorMessage,
          })
        }
      }

      await sleep(config.currentDelay * 1000)
    } catch (groupError) {
      error(`✗ Error with group ${groupInfo.entity.username || groupInfo.entity.id}: ${groupError.message}`)
      results.push({
        success: false,
        group: groupInfo.entity.username || groupInfo.entity.id,
        error: groupError.message,
      })

      await sleep(config.currentDelay * 1000)
    }
  }

  const successCount = results.filter((r) => r.success).length
  const failCount = results.filter((r) => !r.success).length
  info(
    `\nAccount ${config.account.phoneNumber} completed. Success: ${successCount}/${config.writableGroups.length}, Failed: ${failCount}`,
  )

  return results
}

async function messageAllPrivateChats() {
  clearConsole()
  info("=== MASS PM ===")

  const accounts = getSavedAccounts()

  if (accounts.length === 0) {
    error("No accounts found. Please add an account first.")
    await sleep(1500)
    await displayMainMenu()
    return
  }

  console.log(`${WHITE}\nSelect accounts to use:${RESET}`)
  accounts.forEach((account, index) => {
    console.log(`${WHITE}${index + 1}. ${account.phoneNumber || "Unknown"}${RESET}`)
  })

  let selectedAccountsInput
  try {
    selectedAccountsInput = await input.text("Enter account numbers separated by commas (e.g., 1,2): ")
  } catch (inputError) {
    return messageAllPrivateChats()
  }

  const selectedIndices = selectedAccountsInput.split(",").map((num) => Number.parseInt(num.trim()) - 1)

  const selectedAccounts = selectedIndices
    .filter((index) => index >= 0 && index < accounts.length)
    .map((index) => accounts[index])

  if (selectedAccounts.length === 0) {
    error("No valid accounts selected.")
    await sleep(1500)
    await messageAllPrivateChats()
    return
  }

  info(`\nSelected ${selectedAccounts.length} accounts.`)

  console.log(`${WHITE}\nHow would you like to send messages?${RESET}`)
  console.log(`${WHITE}1. Send a custom message${RESET}`)
  console.log(`${WHITE}2. Forward a message from a channel${RESET}`)

  let messageTypeChoice
  try {
    messageTypeChoice = await input.text("Select an option (1-2): ")
  } catch (inputError) {
    return messageAllPrivateChats()
  }

  let messageText, sourceChannelId, messageId

  if (messageTypeChoice === "1") {
    try {
      messageText = await input.text("Enter the message to send to all private chats: ")
    } catch (inputError) {
      error("Error reading message. Operation cancelled.")
      await sleep(1500)
      await displayMainMenu()
      return
    }
  } else if (messageTypeChoice === "2") {
    try {
      sourceChannelId = await input.text("Enter source channel username or ID: ")
      messageId = Number.parseInt(await input.text("Enter message ID to forward: "))
    } catch (inputError) {
      error("Error reading input. Operation cancelled.")
      await sleep(1500)
      await displayMainMenu()
      return
    }
  } else {
    error("Invalid option.")
    await sleep(1500)
    await messageAllPrivateChats()
    return
  }

  let messageDelay
  try {
    messageDelay = Number.parseFloat(await input.text("Enter delay between messages in seconds (e.g. 1.5): "))
  } catch (inputError) {
    messageDelay = 1.5
    console.log(`${WHITE}Using default delay: ${messageDelay} seconds${RESET}`)
  }

  let confirmSend
  try {
    confirmSend = await input.text(`Are you sure you want to send this message to all private chats? (y/n): `)
  } catch (inputError) {
    confirmSend = "n"
  }

  if (confirmSend.toLowerCase() !== "y") {
    console.log(`${WHITE}Operation cancelled.${RESET}`)
    await sleep(1500)
    await displayMainMenu()
    return
  }

  for (const account of selectedAccounts) {
    info(`\nProcessing account: ${account.phoneNumber}`)

    const accountNumber = account.filename.match(/account(\d+)\.json/)[1]
    const cachedChats = loadPrivateChatsForAccount(accountNumber)
    let privateChats = []

    let client
    try {
      client = await connectClient(account)

      if (cachedChats && cachedChats.privateChats && cachedChats.privateChats.length > 0) {
        const lastCheckedDate = new Date(cachedChats.lastUpdated)
        info(`Found cached private chats from ${lastCheckedDate.toLocaleString()}.`)

        let useCache
        try {
          useCache = await input.text("Use cached private chats? (y/n): ")
        } catch (inputError) {
          useCache = "y"
        }

        if (useCache.toLowerCase() === "y") {
          privateChats = cachedChats.privateChats
          console.log(`${WHITE}Using ${privateChats.length} cached private chats.${RESET}`)
        } else {
          console.log(`${WHITE}Fetching fresh private chats...${RESET}`)
          const dialogs = await client.getDialogs()

          privateChats = dialogs
            .filter((dialog) => dialog.entity.className === "User")
            .map((dialog) => {
              const user = dialog.entity
              return {
                id: user.id,
                username: user.username,
                firstName: user.firstName,
                lastName: user.lastName,
                phone: user.phone,
                accessHash: user.accessHash,
              }
            })

          const chatsData = {
            privateChats,
            lastUpdated: Date.now(),
          }

          savePrivateChatsForAccount(accountNumber, chatsData)
        }
      } else {
        console.log(`${WHITE}No cached private chats found. Fetching fresh data...${RESET}`)
        const dialogs = await client.getDialogs()

        privateChats = dialogs
          .filter((dialog) => dialog.entity.className === "User")
          .map((dialog) => {
            const user = dialog.entity
            return {
              id: user.id,
              username: user.username,
              firstName: user.firstName,
              lastName: user.lastName,
              phone: user.phone,
              accessHash: user.accessHash,
            }
          })

        const chatsData = {
          privateChats,
          lastUpdated: Date.now(),
        }

        savePrivateChatsForAccount(accountNumber, chatsData)
      }

      info(`Found ${privateChats.length} private chats for ${account.phoneNumber}`)

      if (privateChats.length === 0) {
        error("No private chats found for this account.")
        await client.disconnect()
        continue
      }

      let sourceChannel
      if (messageTypeChoice === "2") {
        try {
          sourceChannel = await client.getEntity(sourceChannelId)
        } catch (entityError) {
          error("Could not find the source channel. Skipping this account.")
          await client.disconnect()
          continue
        }
      }

      let currentDelay = messageDelay
      let successCount = 0
      let failCount = 0

      for (let i = 0; i < privateChats.length; i++) {
        const user = privateChats[i]
        const userName = user.username || `User${user.id}`

        console.log(`${WHITE}\nSending message to ${userName} (${i + 1}/${privateChats.length})...${RESET}`)

        try {
          const inputPeer = new Api.InputPeerUser({
            userId: user.id,
            accessHash: user.accessHash || 0,
          })

          if (messageTypeChoice === "1") {
            await client.sendMessage(inputPeer, { message: messageText })
          } else {
            await client.invoke(
              new Api.messages.ForwardMessages({
                fromPeer: sourceChannel,
                id: [messageId],
                randomId: [Math.floor(Math.random() * 2147483647)],
                toPeer: inputPeer,
                withMyScore: false,
                dropAuthor: false,
                dropMediaCaptions: false,
              }),
            )
          }

          success(`✓ Message sent to ${userName}`)
          successCount++
        } catch (messageError) {
          const floodWaitMatch = messageError.message.match(/FLOOD_WAIT_(\d+)/)
          if (floodWaitMatch) {
            const waitSeconds = Number.parseInt(floodWaitMatch[1])
            console.log(`${WHITE}⚠️ Rate limit hit! Waiting for ${waitSeconds} seconds...${RESET}`)

            await sleep(waitSeconds * 1000)

            currentDelay = currentDelay * 2
            console.log(`${WHITE}Increased delay to ${currentDelay} seconds for future messages${RESET}`)

            try {
              const inputPeer = new Api.InputPeerUser({
                userId: user.id,
                accessHash: user.accessHash || 0,
              })

              if (messageTypeChoice === "1") {
                await client.sendMessage(inputPeer, { message: messageText })
              } else {
                await client.invoke(
                  new Api.messages.ForwardMessages({
                    fromPeer: sourceChannel,
                    id: [messageId],
                    randomId: [Math.floor(Math.random() * 2147483647)],
                    toPeer: inputPeer,
                    withMyScore: false,
                    dropAuthor: false,
                    dropMediaCaptions: false,
                  }),
                )
              }

              success(`✓ Message sent to ${userName} after waiting`)
              successCount++
            } catch (retryError) {
              error(`✗ Failed to send message to ${userName}: ${retryError.message}`)
              failCount++
            }
          } else {
            error(`✗ Failed to send message to ${userName}: ${messageError.message}`)
            failCount++
          }
        }

        if (i < privateChats.length - 1) {
          await sleep(currentDelay * 1000)
        }
      }

      info(`\nAccount ${account.phoneNumber} completed. Success: ${successCount}, Failed: ${failCount}`)
      await client.disconnect()
    } catch (accountError) {
      error(`Error processing account ${account.phoneNumber}: ${accountError.message}`)
      if (client) {
        try {
          await client.disconnect()
        } catch (disconnectError) {
          console.error("Error disconnecting client:", disconnectError.message)
        }
      }
    }
  }

  success("\nOperation completed.")
  await sleep(1500)
  await displayMainMenu()
}

function readLinesFromFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` }
    }

    const content = fs.readFileSync(filePath, "utf8")
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    return { success: true, lines }
  } catch (fileError) {
    return { success: false, error: fileError.message }
  }
}

function listTextFiles() {
  try {
    const files = fs.readdirSync(__dirname)
    return files.filter((file) => file.endsWith(".txt"))
  } catch (readError) {
    return []
  }
}

async function sendNewPrivateMessages() {
  clearConsole()
  info("=== MASS DM ===")

  const accounts = getSavedAccounts()

  if (accounts.length === 0) {
    error("No accounts found. Please add an account first.")
    await sleep(1500)
    await displayMainMenu()
    return
  }

  console.log(`${WHITE}\nSelect accounts to use:${RESET}`)
  accounts.forEach((account, index) => {
    console.log(`${WHITE}${index + 1}. ${account.phoneNumber || "Unknown"}${RESET}`)
  })

  let selectedAccountsInput
  try {
    selectedAccountsInput = await input.text("Enter account numbers separated by commas (e.g., 1,2): ")
  } catch (inputError) {
    return sendNewPrivateMessages()
  }

  const selectedIndices = selectedAccountsInput.split(",").map((num) => Number.parseInt(num.trim()) - 1)

  const selectedAccounts = selectedIndices
    .filter((index) => index >= 0 && index < accounts.length)
    .map((index) => accounts[index])

  if (selectedAccounts.length === 0) {
    error("No valid accounts selected.")
    await sleep(1500)
    return sendNewPrivateMessages()
  }

  info(`\nSelected ${selectedAccounts.length} accounts.`)

  let parsedUsernames = []
  try {
    console.log(`${WHITE}\nHow would you like to input usernames?${RESET}`)
    console.log(`${WHITE}1. From a text file${RESET}`)
    console.log(`${WHITE}2. Enter manually${RESET}`)

    const textFiles = listTextFiles()
    if (textFiles.length > 0) {
      console.log(`${WHITE}\nAvailable text files:${RESET}`)
      textFiles.forEach((file, index) => {
        console.log(`${WHITE}- ${file}${RESET}`)
      })
    }

    const inputChoice = await input.text("Select an option (1-2): ")

    if (inputChoice === "1") {
      const fileName = await input.text("Enter the name of the text file (e.g., usernames.txt): ")
      const filePath = path.join(__dirname, fileName)

      const result = readLinesFromFile(filePath)
      if (!result.success) {
        error(`Error reading file: ${result.error}`)
        await sleep(1500)
        return sendNewPrivateMessages()
      }

      if (result.lines.length === 0) {
        error("No usernames found in the file.")
        await sleep(1500)
        return sendNewPrivateMessages()
      }

      parsedUsernames = result.lines.map((username) => {
        let parsed = username.replace(/^https:\/\//, "")
        parsed = parsed.replace(/^t\.me\//, "")
        parsed = parsed.replace(/\/$/, "")
        return parsed
      })

      info(`\nParsed ${parsedUsernames.length} usernames from file.`)
    } else if (inputChoice === "2") {
      console.log(`${WHITE}\nEnter usernames to message (one per line, can be in formats:${RESET}`)
      console.log(`${WHITE}- username${RESET}`)
      console.log(`${WHITE}- t.me/username${RESET}`)
      console.log(`${WHITE}- https://t.me/username${RESET}`)
      console.log(`${WHITE}Type "done" on a new line when finished:${RESET}`)

      const usernames = []
      while (true) {
        const line = await input.text("> ")
        if (line.toLowerCase() === "done") break
        if (line.trim()) usernames.push(line.trim())
      }

      if (usernames.length === 0) {
        error("No usernames provided. Operation cancelled.")
        await sleep(1500)
        await displayMainMenu()
        return
      }

      parsedUsernames = usernames.map((username) => {
        let parsed = username.replace(/^https:\/\//, "")
        parsed = parsed.replace(/^t\.me\//, "")
        parsed = parsed.replace(/\/$/, "")
        return parsed
      })

      info(`\nParsed ${parsedUsernames.length} usernames.`)
    } else {
      error("Invalid option.")
      await sleep(1500)
      return sendNewPrivateMessages()
    }

    console.log(`${WHITE}\nHow would you like to send messages?${RESET}`)
    console.log(`${WHITE}1. Send a custom message${RESET}`)
    console.log(`${WHITE}2. Forward a message from a channel${RESET}`)

    let messageTypeChoiceInner
    try {
      messageTypeChoiceInner = await input.text("Select an option (1-2): ")
    } catch (inputError) {
      return sendNewPrivateMessages()
    }

    let messageText, sourceChannelId, messageId

    if (messageTypeChoiceInner === "1") {
      try {
        messageText = await input.text("Enter the message to send: ")
      } catch (inputError) {
        error("Error reading message. Operation cancelled.")
        await sleep(1500)
        await displayMainMenu()
        return
      }
    } else if (messageTypeChoiceInner === "2") {
      try {
        sourceChannelId = await input.text("Enter source channel username or ID: ")
        messageId = Number.parseInt(await input.text("Enter message ID to forward: "))
      } catch (inputError) {
        error("Error reading input. Operation cancelled.")
        await sleep(1500)
        await displayMainMenu()
        return
      }
    } else {
      error("Invalid option.")
      await sleep(1500)
      return sendNewPrivateMessages()
    }

    let messageDelay
    try {
      messageDelay = Number.parseFloat(await input.text("Enter delay between messages in seconds (e.g. 1.5): "))
    } catch (inputError) {
      messageDelay = 1.5
      console.log(`${WHITE}Using default delay: ${messageDelay} seconds${RESET}`)
    }

    let confirmSend
    try {
      confirmSend = await input.text(
        `Are you sure you want to send messages to ${parsedUsernames.length} users? (y/n): `,
      )
    } catch (inputError) {
      confirmSend = "n"
    }

    if (confirmSend.toLowerCase() !== "y") {
      console.log(`${WHITE}Operation cancelled.${RESET}`)
      await sleep(1500)
      await displayMainMenu()
      return
    }

    for (const account of selectedAccounts) {
      info(`\nProcessing account: ${account.phoneNumber}`)

      let client
      try {
        client = await connectClient(account)

        let sourceChannel
        if (messageTypeChoiceInner === "2") {
          try {
            sourceChannel = await client.getEntity(sourceChannelId)
          } catch (entityError) {
            error("Could not find the source channel. Skipping this account.")
            await client.disconnect()
            continue
          }
        }

        let currentDelay = messageDelay
        let successCount = 0
        let failCount = 0

        for (let i = 0; i < parsedUsernames.length; i++) {
          const username = parsedUsernames[i]

          console.log(`${WHITE}\nSending message to ${username} (${i + 1}/${parsedUsernames.length})...${RESET}`)

          try {
            const user = await client.getEntity(username)

            if (user.className !== "User") {
              error(`✗ ${username} is not a user. Skipping.`)
              failCount++
              continue
            }

            const inputPeer = new Api.InputPeerUser({
              userId: user.id,
              accessHash: user.accessHash || 0,
            })

            if (messageTypeChoiceInner === "1") {
              await client.sendMessage(inputPeer, { message: messageText })
            } else {
              await client.invoke(
                new Api.messages.ForwardMessages({
                  fromPeer: sourceChannel,
                  id: [messageId],
                  randomId: [Math.floor(Math.random() * 2147483647)],
                  toPeer: inputPeer,
                  withMyScore: false,
                  dropAuthor: false,
                  dropMediaCaptions: false,
                }),
              )
            }

            success(`✓ Message sent to ${username}`)
            successCount++
          } catch (dmError) {
            const floodWaitMatch = dmError.message.match(/FLOOD_WAIT_(\d+)/)
            if (floodWaitMatch) {
              const waitSeconds = Number.parseInt(floodWaitMatch[1])
              console.log(`${WHITE}⚠️ Rate limit hit! Waiting for ${waitSeconds} seconds...${RESET}`)

              await sleep(waitSeconds * 1000)

              currentDelay = currentDelay * 2
              console.log(`${WHITE}Increased delay to ${currentDelay} seconds for future messages${RESET}`)

              try {
                const user = await client.getEntity(username)

                if (user.className !== "User") {
                  error(`✗ ${username} is not a user. Skipping.`)
                  failCount++
                  continue
                }

                const inputPeer = new Api.InputPeerUser({
                  userId: user.id,
                  accessHash: user.accessHash || 0,
                })

                if (messageTypeChoiceInner === "1") {
                  await client.sendMessage(inputPeer, { message: messageText })
                } else {
                  await client.invoke(
                    new Api.messages.ForwardMessages({
                      fromPeer: sourceChannel,
                      id: [messageId],
                      randomId: [Math.floor(Math.random() * 2147483647)],
                      toPeer: inputPeer,
                      withMyScore: false,
                      dropAuthor: false,
                      dropMediaCaptions: false,
                    }),
                  )
                }

                success(`✓ Message sent to ${username} after waiting`)
                successCount++
              } catch (retryError) {
                error(`✗ Failed to send message to ${username}: ${retryError.message}`)
                failCount++
              }
            } else {
              error(`✗ Failed to send message to ${username}: ${dmError.message}`)
              failCount++
            }
          }

          if (i < parsedUsernames.length - 1) {
            await sleep(currentDelay * 1000)
          }
        }

        info(`\nAccount ${account.phoneNumber} completed. Success: ${successCount}, Failed: ${failCount}`)
        await client.disconnect()
      } catch (accountError) {
        error(`Error processing account ${account.phoneNumber}: ${accountError.message}`)
        if (client) {
          try {
            await client.disconnect()
          } catch (disconnectError) {
            console.error("Error disconnecting client:", disconnectError.message)
          }
        }
      }
    }

    success("\nOperation completed.")
    await sleep(1500)
    await displayMainMenu()
  } catch (unexpectedError) {
    console.error("Unexpected error in sendNewPrivateMessages:", unexpectedError.message)
    await sleep(1500)
    await displayMainMenu()
  }
}

async function joinGroups() {
  clearConsole()
  info("=== GROUP JOINER ===")

  const accounts = getSavedAccounts()

  if (accounts.length === 0) {
    error("No accounts found. Please add an account first.")
    await sleep(1500)
    await displayMainMenu()
    return
  }

  console.log(`${WHITE}\nSelect accounts to use:${RESET}`)
  accounts.forEach((account, index) => {
    console.log(`${WHITE}${index + 1}. ${account.phoneNumber || "Unknown"}${RESET}`)
  })

  let selectedAccountsInput
  try {
    selectedAccountsInput = await input.text("Enter account numbers separated by commas (e.g., 1,2): ")
  } catch (inputError) {
    return joinGroups()
  }

  const selectedIndices = selectedAccountsInput.split(",").map((num) => Number.parseInt(num.trim()) - 1)

  const selectedAccounts = selectedIndices
    .filter((index) => index >= 0 && index < accounts.length)
    .map((index) => accounts[index])

  if (selectedAccounts.length === 0) {
    error("No valid accounts selected.")
    await sleep(1500)
    return joinGroups()
  }

  info(`\nSelected ${selectedAccounts.length} accounts.`)

  let groupLinks = []
  try {
    console.log(`${WHITE}\nHow would you like to input group links?${RESET}`)
    console.log(`${WHITE}1. From a text file${RESET}`)
    console.log(`${WHITE}2. Enter manually${RESET}`)

    const textFiles = listTextFiles()
    if (textFiles.length > 0) {
      console.log(`${WHITE}\nAvailable text files:${RESET}`)
      textFiles.forEach((file, index) => {
        console.log(`${WHITE}- ${file}${RESET}`)
      })
    }

    const inputChoice = await input.text("Select an option (1-2): ")

    if (inputChoice === "1") {
      const fileName = await input.text("Enter the name of the text file (e.g., grouplinks.txt): ")
      const filePath = path.join(__dirname, fileName)

      const result = readLinesFromFile(filePath)
      if (!result.success) {
        error(`Error reading file: ${result.error}`)
        await sleep(1500)
        return joinGroups()
      }

      if (result.lines.length === 0) {
        error(`No group links found in the file.`)
        await sleep(1500)
        return joinGroups()
      }

      groupLinks = result.lines.map((link) => {
        let parsed = link.replace(/^https:\/\//, "")
        parsed = parsed.replace(/^t\.me\//, "")
        parsed = parsed.replace(/\/$/, "")
        return parsed
      })

      info(`\nParsed ${groupLinks.length} group links from file.`)
    } else if (inputChoice === "2") {
      console.log(`${WHITE}\nEnter group links to join (one per line, can be in formats:${RESET}`)
      console.log(`${WHITE}- t.me/groupname${RESET}`)
      console.log(`${WHITE}- https://t.me/groupname${RESET}`)
      console.log(`${WHITE}Type "done" on a new line when finished:${RESET}`)

      const links = []
      while (true) {
        const line = await input.text("> ")
        if (line.toLowerCase() === "done") break
        if (line.trim()) links.push(line.trim())
      }

      if (links.length === 0) {
        error("No group links provided. Operation cancelled.")
        await sleep(1500)
        await displayMainMenu()
        return
      }

      groupLinks = links.map((link) => {
        let parsed = link.replace(/^https:\/\//, "")
        parsed = parsed.replace(/^t\.me\//, "")
        parsed = parsed.replace(/\/$/, "")
        return parsed
      })

      info(`\nParsed ${groupLinks.length} group links.`)
    } else {
      error("Invalid option.")
      await sleep(1500)
      return joinGroups()
    }

    let joinDelay
    try {
      joinDelay = Number.parseFloat(await input.text("Enter delay between joins in seconds (e.g. 5): "))
    } catch (inputError) {
      joinDelay = 5
      console.log(`${WHITE}Using default delay: ${joinDelay} seconds${RESET}`)
    }

    let confirmJoin
    try {
      confirmJoin = await input.text(
        `Are you sure you want to join ${groupLinks.length} groups with the selected accounts? (y/n): `,
      )
    } catch (inputError) {
      confirmJoin = "n"
    }

    if (confirmJoin.toLowerCase() !== "y") {
      console.log(`${WHITE}Operation cancelled.${RESET}`)
      await sleep(1500)
      await displayMainMenu()
      return
    }

    for (const account of selectedAccounts) {
      info(`\nProcessing account: ${account.phoneNumber}`)

      let client
      try {
        client = await connectClient(account)

        let currentDelay = joinDelay
        let successCount = 0
        let failCount = 0

        for (let i = 0; i < groupLinks.length; i++) {
          const groupLink = groupLinks[i]

          console.log(`${WHITE}\nJoining group ${groupLink} (${i + 1}/${groupLinks.length})...${RESET}`)

          try {
            const entity = await client.getEntity(groupLink)

            if (entity.className === "Channel") {
              await client.invoke(
                new Api.channels.JoinChannel({
                  channel: entity,
                }),
              )
              success(`✓ Joined group ${groupLink}`)
              successCount++
            } else if (entity.className === "Chat") {
              await client.invoke(
                new Api.messages.AddChatUser({
                  chatId: entity.id,
                  userId: "me",
                  fwdLimit: 0,
                }),
              )
              success(`✓ Joined group ${groupLink}`)
              successCount++
            } else {
              error(`✗ ${groupLink} is not a channel or chat. Skipping.`)
              failCount++
            }
          } catch (joinError) {
            // Check for FLOOD_WAIT error
            const floodWaitMatch = joinError.message.match(/FLOOD_WAIT_(\d+)/)
            const waitMatch = joinError.message.match(/A wait of (\d+) seconds is required/)

            if (floodWaitMatch || waitMatch) {
              const waitSeconds = floodWaitMatch ? Number.parseInt(floodWaitMatch[1]) : Number.parseInt(waitMatch[1])

              console.log(`${WHITE}⚠️ FLOOD ERROR: Rate limit hit for ${groupLink}!${RESET}`)
              console.log(`${WHITE}⚠️ Waiting for ${waitSeconds} seconds before continuing...${RESET}`)
              console.log(`${WHITE}⚠️ Stopping all operations until wait period is over...${RESET}`)

              // Wait for the FULL flood wait time
              await sleep(waitSeconds * 1000)

              // Double the current delay AFTER waiting
              currentDelay = currentDelay * 2
              console.log(
                `${WHITE}✓ Wait period completed. Increased delay to ${currentDelay} seconds for future joins.${RESET}`,
              )

              // Now retry the same group
              try {
                console.log(`${WHITE}Retrying join for ${groupLink}...${RESET}`)
                const entity = await client.getEntity(groupLink)

                if (entity.className === "Channel") {
                  await client.invoke(
                    new Api.channels.JoinChannel({
                      channel: entity,
                    }),
                  )
                  success(`✓ Joined group ${groupLink} after waiting`)
                  successCount++
                } else if (entity.className === "Chat") {
                  await client.invoke(
                    new Api.messages.AddChatUser({
                      chatId: entity.id,
                      userId: "me",
                      fwdLimit: 0,
                    }),
                  )
                  success(`✓ Joined group ${groupLink} after waiting`)
                  successCount++
                }
              } catch (retryError) {
                error(`✗ Failed to join group ${groupLink} after retry: ${retryError.message}`)
                failCount++
              }
            } else {
              error(`✗ Failed to join group ${groupLink}: ${joinError.message}`)
              failCount++
            }
          }

          // Apply the current delay before next group (if not the last group)
          if (i < groupLinks.length - 1) {
            console.log(`${WHITE}Waiting ${currentDelay} seconds before next join...${RESET}`)
            await sleep(currentDelay * 1000)
          }
        }

        info(`\nAccount ${account.phoneNumber} completed. Success: ${successCount}, Failed: ${failCount}`)
        await client.disconnect()
      } catch (accountError) {
        error(`Error processing account ${account.phoneNumber}: ${accountError.message}`)
        if (client) {
          try {
            await client.disconnect()
          } catch (disconnectError) {
            console.error("Error disconnecting client:", disconnectError.message)
          }
        }
      }
    }

    success("\nOperation completed.")
    await sleep(1500)
    await displayMainMenu()
  } catch (unexpectedError) {
    console.error("Unexpected error in joinGroups:", unexpectedError.message)
    await sleep(1500)
    await displayMainMenu()
  }
}

async function groupAdder() {
  clearConsole()
  info("=== MEMBER ADDER ===")

  const accounts = getSavedAccounts()

  if (accounts.length === 0) {
    error("No accounts found. Please add an account first.")
    await sleep(1500)
    await displayMainMenu()
    return
  }

  console.log(`${WHITE}\nSelect accounts to use:${RESET}`)
  accounts.forEach((account, index) => {
    console.log(`${WHITE}${index + 1}. ${account.phoneNumber || "Unknown"}${RESET}`)
  })

  let selectedAccountsInput
  try {
    selectedAccountsInput = await input.text("Enter account numbers separated by commas (e.g., 1,2): ")
  } catch (inputError) {
    return groupAdder()
  }

  const selectedIndices = selectedAccountsInput.split(",").map((num) => Number.parseInt(num.trim()) - 1)

  const selectedAccounts = selectedIndices
    .filter((index) => index >= 0 && index < accounts.length)
    .map((index) => accounts[index])

  if (selectedAccounts.length === 0) {
    error("No valid accounts selected.")
    await sleep(1500)
    return groupAdder()
  }

  info(`\nSelected ${selectedAccounts.length} accounts.`)

  let groupLink
  try {
    groupLink = await input.text("Enter the group/channel link you want to add users to (e.g., t.me/groupname): ")
    groupLink = groupLink
      .replace(/^https:\/\//, "")
      .replace(/^t\.me\//, "")
      .replace(/\/$/, "")
  } catch (inputError) {
    error("Error reading input. Operation cancelled.")
    await sleep(1500)
    await displayMainMenu()
    return
  }

  let usernames = []
  try {
    console.log(`${WHITE}\nHow would you like to input usernames?${RESET}`)
    console.log(`${WHITE}1. From a text file${RESET}`)
    console.log(`${WHITE}2. Enter manually${RESET}`)

    const textFiles = listTextFiles()
    if (textFiles.length > 0) {
      console.log(`${WHITE}\nAvailable text files:${RESET}`)
      textFiles.forEach((file) => {
        console.log(`${WHITE}- ${file}${RESET}`)
      })
    }

    const inputChoice = await input.text("Select an option (1-2): ")

    if (inputChoice === "1") {
      const fileName = await input.text("Enter the name of the text file (e.g., usernames.txt): ")
      const filePath = path.join(__dirname, fileName)

      const result = readLinesFromFile(filePath)
      if (!result.success) {
        error(`Error reading file: ${result.error}`)
        await sleep(1500)
        return groupAdder()
      }

      if (result.lines.length === 0) {
        error("No usernames found in the file.")
        await sleep(1500)
        return groupAdder()
      }

      usernames = result.lines.map((username) => {
        let parsed = username.replace(/^https:\/\//, "")
        parsed = parsed.replace(/^t\.me\//, "")
        parsed = parsed.replace(/\/$/, "")
        return parsed
      })

      info(`\nParsed ${usernames.length} usernames from file.`)
    } else if (inputChoice === "2") {
      console.log(`${WHITE}\nEnter usernames to add (one per line):${RESET}`)
      console.log(`${WHITE}Type "done" on a new line when finished:${RESET}`)

      const lines = []
      while (true) {
        const line = await input.text("> ")
        if (line.toLowerCase() === "done") break
        if (line.trim()) lines.push(line.trim())
      }

      if (lines.length === 0) {
        error("No usernames provided. Operation cancelled.")
        await sleep(1500)
        await displayMainMenu()
        return
      }

      usernames = lines.map((username) => {
        let parsed = username.replace(/^https:\/\//, "")
        parsed = parsed.replace(/^t\.me\//, "")
        parsed = parsed.replace(/\/$/, "")
        return parsed
      })

      info(`\nParsed ${usernames.length} usernames.`)
    } else {
      error("Invalid option.")
      await sleep(1500)
      return groupAdder()
    }

    let addDelay
    try {
      addDelay = Number.parseFloat(await input.text("Enter delay between adding users in seconds (e.g. 5): "))
    } catch (inputError) {
      addDelay = 5
      console.log(`${WHITE}Using default delay: ${addDelay} seconds${RESET}`)
    }

    let confirmAdd
    try {
      confirmAdd = await input.text(`Are you sure you want to add ${usernames.length} users to ${groupLink}? (y/n): `)
    } catch (inputError) {
      confirmAdd = "n"
    }

    if (confirmAdd.toLowerCase() !== "y") {
      console.log(`${WHITE}Operation cancelled.${RESET}`)
      await sleep(1500)
      await displayMainMenu()
      return
    }

    const connectedClients = []
    for (const account of selectedAccounts) {
      try {
        const client = await connectClient(account)
        connectedClients.push({
          client,
          account,
        })
      } catch (connectionError) {
        error(`Failed to connect to account ${account.phoneNumber}. Skipping.`)
      }
    }

    if (connectedClients.length === 0) {
      error("Failed to connect to any accounts. Operation cancelled.")
      await sleep(1500)
      await displayMainMenu()
      return
    }

    let targetGroup
    try {
      targetGroup = await connectedClients[0].client.getEntity(groupLink)
    } catch (entityError) {
      error(`Could not find the group/channel ${groupLink}. Make sure the link is correct and you are a member.`)

      for (const { client } of connectedClients) {
        try {
          await client.disconnect()
        } catch (disconnectError) {
          console.error("Error disconnecting client:", disconnectError.message)
        }
      }

      await sleep(1500)
      await displayMainMenu()
      return
    }

    info(`\nStarting to add users to ${targetGroup.title || groupLink}...`)

    let successCount = 0
    let failCount = 0
    let currentDelay = addDelay

    for (let i = 0; i < usernames.length; i++) {
      const username = usernames[i]

      const clientIndex = i % connectedClients.length
      const { client, account } = connectedClients[clientIndex]

      console.log(
        `${WHITE}\nAdding ${username} to ${targetGroup.title || groupLink} using account ${account.phoneNumber} (${i + 1}/${usernames.length})...${RESET}`,
      )

      try {
        console.log(`${WHITE}Adding ${username} to contacts...${RESET}`)

        try {
          const user = await client.getEntity(username)

          if (user.className !== "User") {
            error(`✗ ${username} is not a user. Skipping.`)
            failCount++
            continue
          }

          await client.invoke(
            new Api.contacts.AddContact({
              id: user,
              firstName: user.firstName || username,
              lastName: user.lastName || "",
              phone: user.phone || "",
              addPhonePrivacyException: true,
            }),
          )

          success(`✓ Added ${username} to contacts`)

          console.log(`${WHITE}Adding ${username} to ${targetGroup.title || groupLink}...${RESET}`)

          if (targetGroup.className === "Channel") {
            await client.invoke(
              new Api.channels.InviteToChannel({
                channel: targetGroup,
                users: [user],
              }),
            )
          } else if (targetGroup.className === "Chat") {
            await client.invoke(
              new Api.messages.AddChatUser({
                chatId: targetGroup.id,
                userId: user,
                fwdLimit: 0,
              }),
            )
          }

          success(`✓ Added ${username} to ${targetGroup.title || groupLink}`)
          successCount++
        } catch (addError) {
          const floodWaitMatch = addError.message.match(/FLOOD_WAIT_(\d+)/)
          if (floodWaitMatch) {
            const waitSeconds = Number.parseInt(floodWaitMatch[1])
            console.log(`${WHITE}⚠️ Rate limit hit! Waiting for ${waitSeconds} seconds...${RESET}`)

            await sleep(waitSeconds * 1000)

            currentDelay = currentDelay * 2
            console.log(`${WHITE}Increased delay to ${currentDelay} seconds for future operations${RESET}`)

            try {
              const user = await client.getEntity(username)

              if (user.className !== "User") {
                error(`✗ ${username} is not a user. Skipping.`)
                failCount++
                continue
              }

              await client.invoke(
                new Api.contacts.AddContact({
                  id: user,
                  firstName: user.firstName || username,
                  lastName: user.lastName || "",
                  phone: user.phone || "",
                  addPhonePrivacyException: true,
                }),
              )

              success(`✓ Added ${username} to contacts after waiting`)

              if (targetGroup.className === "Channel") {
                await client.invoke(
                  new Api.channels.InviteToChannel({
                    channel: targetGroup,
                    users: [user],
                  }),
                )
              } else if (targetGroup.className === "Chat") {
                await client.invoke(
                  new Api.messages.AddChatUser({
                    chatId: targetGroup.id,
                    userId: user,
                    fwdLimit: 0,
                  }),
                )
              }

              success(`✓ Added ${username} to ${targetGroup.title || groupLink} after waiting`)
              successCount++
            } catch (retryError) {
              error(`✗ Failed to add ${username}: ${retryError.message}`)
              failCount++
            }
          } else {
            error(`✗ Failed to add ${username}: ${addError.message}`)
            failCount++
          }
        }
      } catch (userError) {
        error(`✗ Error processing ${username}: ${userError.message}`)
        failCount++
      }

      if (i < usernames.length - 1) {
        await sleep(currentDelay * 1000)
      }
    }

    for (const { client } of connectedClients) {
      try {
        await client.disconnect()
      } catch (disconnectError) {
        console.error("Error disconnecting client:", disconnectError.message)
      }
    }

    info(`\nOperation completed. Success: ${successCount}, Failed: ${failCount}`)
    await sleep(1500)
    await displayMainMenu()
  } catch (unexpectedError) {
    console.error("Unexpected error in groupAdder:", unexpectedError.message)
    await sleep(1500)
    await displayMainMenu()
  }
}

async function commentSectionDownload() {
  clearConsole()
  info("=== COMMENT SECTION DOWNLOAD ===")

  const accounts = getSavedAccounts()

  if (accounts.length === 0) {
    error("No accounts found. Please add an account first.")
    await sleep(1500)
    await displayMainMenu()
    return
  }

  console.log(`${WHITE}\nSelect accounts to use:${RESET}`)
  accounts.forEach((account, index) => {
    console.log(`${WHITE}${index + 1}. ${account.phoneNumber || "Unknown"}${RESET}`)
  })

  let selectedAccountIndex
  try {
    selectedAccountIndex = Number.parseInt(await input.text("Select an account: ")) - 1
  } catch (inputError) {
    return commentSectionDownload()
  }

  if (selectedAccountIndex < 0 || selectedAccountIndex >= accounts.length) {
    error("Invalid account selection.")
    await sleep(1500)
    return commentSectionDownload()
  }

  const selectedAccount = accounts[selectedAccountIndex]
  console.log(`${WHITE}\nSelected account: ${selectedAccount.phoneNumber}${RESET}`)

  let messageLink
  try {
    messageLink = await input.text("Enter the link to a Telegram message (e.g., t.me/channel/123): ")
  } catch (inputError) {
    error("Error reading input. Operation cancelled.")
    await sleep(1500)
    await displayMainMenu()
    return
  }

  const linkParts = messageLink.match(/t\.me\/([^/]+)\/(\d+)/)
  if (!linkParts) {
    error("Invalid message link format. Expected format: t.me/channelname/123 or https://t.me/channelname/123")
    await sleep(1500)
    await displayMainMenu()
    return
  }

  const [, channelName, messageId] = linkParts

  let client
  try {
    client = await connectClient(selectedAccount)
  } catch (connectionError) {
    error(`Failed to connect to account ${selectedAccount.phoneNumber}.`)
    await sleep(1500)
    await displayMainMenu()
    return
  }

  try {
    const channel = await client.getEntity(channelName)

    const message = await client.getMessages(channel, {
      ids: Number.parseInt(messageId),
    })

    if (!message[0]) {
      error("Message not found.")
      await client.disconnect()
      await sleep(1500)
      await displayMainMenu()
      return
    }

    info("\nMessage found:")
    console.log(`${WHITE}From: ${channelName}${RESET}`)
    console.log(`${WHITE}Text: ${message[0].message}${RESET}`)
    console.log(`${WHITE}\nFetching comments...${RESET}`)

    const comments = await client.getMessages(channel, {
      replyTo: Number.parseInt(messageId),
    })

    info(`\nFound ${comments.length} comments.`)

    if (comments.length === 0) {
      error("No comments found for this message.")
      await client.disconnect()
      await sleep(1500)
      await displayMainMenu()
      return
    }

    const usernames = []
    for (const comment of comments) {
      if (comment.sender && comment.sender.username) {
        usernames.push(comment.sender.username)
      }
    }

    const uniqueUsernames = [...new Set(usernames)]
    const usernamesText = uniqueUsernames.join("\n")
    fs.writeFileSync(path.join(__dirname, "usernames.txt"), usernamesText)

    success(`\nSaved ${uniqueUsernames.length} unique usernames to usernames.txt`)

    console.log(`${WHITE}\nSample comments:${RESET}`)
    const sampleSize = Math.min(5, comments.length)
    for (let i = 0; i < sampleSize; i++) {
      const comment = comments[i]
      console.log(
        `${WHITE}${i + 1}. From: ${comment.sender ? comment.sender.username || comment.sender.firstName : "Unknown"}${RESET}`,
      )
      console.log(`${WHITE}   Text: ${comment.message}${RESET}`)
    }

    await client.disconnect()
    await sleep(1500)
    await displayScraperMenu()
  } catch (fetchError) {
    error(`Error fetching message or comments: ${fetchError.message}`)
    if (client) {
      await client.disconnect()
    }
    await sleep(1500)
    await displayScraperMenu()
  }
}

async function main() {
  try {
    // Bypass license verification
    await displayMainMenu()
  } catch (mainError) {
    console.error("An unexpected error occurred:", mainError)
    process.exit(1)
  }
}

main()
