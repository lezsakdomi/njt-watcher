import * as functions from 'firebase-functions'
import Axios from 'axios'
import * as cheerio from 'cheerio'
import * as admin from 'firebase-admin'

const keywords = ["érettségi"]

export default keywords.reduce((a, keyword) => Object.assign(a, {
    [keyword.normalize('NFD').replace(/[\u0300-\u036f]/g, "")]:
        functions.pubsub.schedule("* * * * *").onRun(async () => {
            const cMethodName = 'finder'
            const cParam = `evszam=2020&sorszam=&kibtip=nincs&szo=${keyword}&pontosszo=0&cimben=0&kozlony=0&szolg=undefined&oldaltol=0&oldalig=9`

            const cMethod = "http://njt.hu/" + getMethod(cMethodName)
            const cParamEx = makeNJTParam(cParam)

            const result = await Axios.post(cMethod, cParamEx, {
                responseType: 'document',
            })

            const $ = cheerio.load(result.data)

            const elements = $('body > div.itemHolder')
            // tslint:disable-next-line:prefer-for-of
            for (let i = 0; i < elements.length; i++) {
                const element = elements[i]

                try {
                    const href = $('div.listItem > h1 > a', element).attr('href')
                    const title = $('div.listItem > h1 > a', element).text()
                    const effect = $('div.listItem > h1 + span', element).text()
                    // const effective = $('div.listItem > h1', e).attr('class') === "ht";
                    const description = $('div.listItem > p', element).text()

                    console.log(JSON.stringify({
                        href,
                        title,
                        effect,
                        description,
                    }))

                    const hrefMatch = href?.match(/^javascript:njtDocument\('(\d+)\.(\d+)'\);$/)
                    console.assert(Array.isArray(hrefMatch), "href matches regex for \"%s\"", title)
                    const [, id, subId] = hrefMatch as [string, string, string]

                    const effectMatch = effect?.match(/^(\d{4}-\d{2}-\d{2})(?:- (\d{4}-\d{2}-\d{2}))?$/)
                    console.assert(Array.isArray(effectMatch), "effect matches regex for \"%s\"", title)
                    // noinspection JSUnusedLocalSymbols
                    const [, from] = effectMatch as [string, string, string?]

                    const doc = admin.firestore().collection('watches').doc(keyword).collection('results').doc(id)
                    if (!await doc.get().then(snapshot => snapshot.exists)) {
                        await doc.set({
                            id, subId,
                            title, description,
                            effectStarts: new Date(from),
                            ...$(element).html() && {originalHtml: $(element).html()},
                        })
                    }
                } catch (e) {
                    console.error(e)
                }
            }
        }),
}), {})

function getMethod(cMethodName: 'base' | 'screen' | 'sendmessage' | 'finder' | 'translatefinder' | 'shortlist' | 'todaylist' | 'igenyitem' | 'igenykuld' | 'igenytest' | 'onkorm' | 'onkresult' | 'onkindokresult' | 'tszfind'): string {
    return {
        "base": "njtBase.php",
        "screen": "njtScreen.php",
        "sendmessage": "njtSendMessage.php",
        "finder": "njtFinder.php",
        "translatefinder": "njtTranslateFinder.php",
        "shortlist": "njtShortList.php",
        "todaylist": "njtTodayList.php",
        "igenyitem": "njtShowIgenyItem.php",
        "igenykuld": "njtIgenykuldes.php",
        "igenytest": "njtIgenytest.php",
        "onkorm": "onkorm/modules/ajaxserver.php",
        "onkresult": "onkTalalat.php",
        "onkindokresult": "onkIndokolas.php",
        "tszfind": "njtTszoFind.php",
    }[cMethodName]
}

function makeNJTParam(cParam: string) {
    return "njtcp=" + (new NJTCode).encode(cParam, 0)
}

class NJTCode {
    m_keys = "abcdefghijklmnopqrstuvwxyz"
    m_nums = "0123456789"

    chksum(cInput: string) {
        let sum = 0
        for (let i = 0; i < cInput.length; ++i)
            sum += cInput.charCodeAt(i)
        sum %= cInput.length
        if (sum === 0)
            sum = cInput.length
        return sum
    }

    encode(cInput: string, nVal: number) {
        let u
        const n = this.m_keys.length
        // let d = 0
        let cRet = ""
        const cExt = cInput
        const nChk = this.chksum(cInput)
        for (let i = 0; i < cExt.length; ++i) {
            /*
            var u=cExt.charCodeAt(i)^nVal;
            while ((d=Math.floor(u/n))>0)
               {
                 cRet += this.m_keys.charAt(d);
                 u %= n;
               }
               cRet += this.m_keys.charAt(u);
            */
            u = cExt.charCodeAt(i) ^ nVal
            let strChar = ""
            while (u > 0) {
                strChar = this.m_keys.charAt(u % n) + strChar
                u = Math.floor(u / n)
            }
            cRet += strChar
            cRet += this.m_nums.charAt(Math.floor(Math.random() * 10))
        }
        /*
        var u = nChk ^ nVal;
        while ((d=Math.floor(u/n))>0)
        {
             cRet += this.m_keys.charAt(d);
             u %= n;
           }
           cRet += this.m_keys.charAt(u);
        */
        u = nChk ^ nVal
        let strChar_ = ""
        while (u > 0) {
            strChar_ = this.m_keys.charAt(u % n) + strChar_
            u = Math.floor(u / n)
        }
        cRet += strChar_
        return cRet
    }

    // noinspection JSUnusedGlobalSymbols
    decode(cInput: string, nVal: number) {
        let u = 0
        let cRet = ""
        let ch = " "
        let nPos = -1

        for (let i = 0; i < cInput.length; ++i) {
            ch = cInput.charAt(i)
            nPos = this.m_nums.indexOf(ch)
            if (nPos < 0) {
                nPos = this.m_keys.indexOf(ch)
                if (nPos < 0)
                    return ""
                u *= this.m_keys.length
                u += nPos
            } else {
                cRet += String.fromCharCode(u ^ nVal)
                u = 0
            }
        }

        nPos = cRet.indexOf("_CsM(")
        if (nPos < 0)
            return ""
        const cText = cRet.substr(0, nPos)
        const cChk = this.chksum(cText)
        if (cRet.indexOf(cChk.toString()) < 0)
            return ""

        return cText
    }
}
