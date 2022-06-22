import { schedule } from 'node-cron'
import axios from 'axios'
import { Logger } from 'tslog'

import getArrivalInfo from './getArrivalInfo'
import { hoppieString, HoppieType } from './hoppie'
import { arrInfoSentCache } from './caches'

const cronLogger = new Logger({ name: 'cronLogger' })

const vAmsysMapUri =
  'https://vamsys.io/statistics/map/e084cd47-e432-4fcd-a8c3-7cbf86358c9d'

interface VaAirportInfo {
  name: string
  icao: string
  iata: string
  latitude: string
  longitude: string
}

interface VaFlightInfo {
  id: number
  callsign: string
  'flight-number': string
  pax: number
  cargo: number
  route: string
  network: string
  currentLocation: {
    altitude: number
    heading: number
    latitude: string
    longitude: string
    groundspeed: number
    distance_remaining: number
    distance_flown: number
    departure_time: string
    estimated_arrival_time: string
    time_flown: string
  }
  aircraft: {
    registration: string
    name: string
    code: string
    codename: string
  }
  arrival: VaAirportInfo
  departure: VaAirportInfo
  pilot: {
    username: string
  }
}

const flightShouldReceiveMessage = ({ currentLocation }: VaFlightInfo) =>
  currentLocation.distance_remaining <= 225 &&
  currentLocation.groundspeed >= 250 // To prevent early gate assignments for short flights.

// Auto send arrival info per vAMSYS info
export const cron = () => {
  // TODO: replace with scheduler that supports async such as Bree
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  schedule('* * * * *', async () => {
    cronLogger.info('Checking for arrival aircraft on vAMSYS...')
    const data = (await axios.get(vAmsysMapUri)).data as VaFlightInfo[]
    const flightsToReceiveMessage = data.filter(
      (flight) =>
        flightShouldReceiveMessage(flight) &&
        !arrInfoSentCache.get(flight.callsign)
    )

    cronLogger.info(
      `${data.length} flights found, ${flightsToReceiveMessage.length} eligible arriving flights found.`
    )

    return Promise.all(
      flightsToReceiveMessage.map(async (flight) => {
        arrInfoSentCache.set(flight.callsign, true)
        const arrivalMessage = getArrivalInfo({
          arr: flight.arrival.icao,
          dep: flight.departure.icao,
          callsign: flight.callsign,
        })

        if (process.env.DEV_MODE?.toLowerCase() === 'true') {
          cronLogger.debug(
            `Dev mode enabled, arrival string:\n${arrivalMessage}`
          )
          return
        }

        cronLogger.info(`Sending arrival info to ${flight.callsign}.`)
        await axios.post(
          hoppieString(HoppieType.telex, arrivalMessage, flight.callsign)
        )
      })
    )
  })
}
